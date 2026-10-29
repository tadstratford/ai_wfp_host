/**
 * selectRules — the rule-selection funnel.
 *
 * Two Jev calls, both with a sensitivity lever:
 *   1. tag choice over the (capped) tag vocabulary → active tags ≥ tagThreshold
 *   2. description choice over candidate rules carrying an active tag
 *      (name → short description) → selected rules ≥ probThreshold
 *
 * Full rule `content` is loaded only after selection, so the routing prompt
 * carries name + description + tags only — never full markdown. A workspace
 * with hundreds of rules stays bounded because stage 2 only sees the candidate
 * subset that matched an active tag.
 */

import { loadRules } from "../../rules/loader";
import { askClassifier } from "@shared/typesafe/openRouter";
import type { ChoiceAnswer, Question } from "@shared/typesafe/types";
import { getClassifierKey } from "@backend/core/user/getLLMApiKey";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { maskText, discoverRequestValues } from "@backend/core/knowledge/autoMask";
import { logAndFireJev } from "../jevLog";
import type { SelectedRule, SelectionConfig } from "./types";

const DEFAULTS: SelectionConfig = {
  tagThreshold: 0.3,
  probThreshold: 0.15,
  maxRules: 8,
  maxTags: 50,
  maxCandidates: 40,
};

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Sensitivity levers, read from env so a deployment can tune strictness. */
export function selectionConfig(): SelectionConfig {
  return {
    tagThreshold: num("RULE_TAG_THRESHOLD", DEFAULTS.tagThreshold),
    probThreshold: num("RULE_PROB_THRESHOLD", DEFAULTS.probThreshold),
    maxRules: Math.max(1, Math.round(num("RULE_MAX_RULES", DEFAULTS.maxRules))),
    maxTags: Math.max(1, Math.round(num("RULE_MAX_TAGS", DEFAULTS.maxTags))),
    maxCandidates: Math.max(1, Math.round(num("RULE_MAX_CANDIDATES", DEFAULTS.maxCandidates))),
  };
}

export interface RuleSelectionContext {
  lastRequest?: string;
  activeSkills?: string[];
  sessionId?: string;
  mode?: string;
}

/** Cheap deterministic prefilter used only when no tag matched (or no tags exist)
 *  and the candidate list would exceed `maxCandidates` — keeps stage 2 bounded. */
function keywordScore(rule: { name: string; description?: string }, raw: string): number {
  const hay = `${rule.name} ${rule.description ?? ""}`.toLowerCase();
  const words = raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let score = 0;
  for (const w of words) if (w.length > 2 && hay.includes(w)) score++;
  return score;
}

export async function selectRules(
  databaseId: string,
  userId: string,
  rawMessage: string,
  context?: RuleSelectionContext,
): Promise<SelectedRule[]> {
  const rules = loadRules(databaseId);
  if (rules.length === 0) return [];

  const cfg = selectionConfig();

  let key: string;
  try {
    key = await getClassifierKey(userId);
  } catch {
    return []; // no classifier key — rules are an enhancement, not a hard dependency
  }

  // Privacy-mask the user-derived request (rule names/descriptions are criteria
  // and stay as-is, mirroring skillRouter).
  let privacyMap = loadPrivacyMap(databaseId);
  const probe = {
    system: "",
    messages: [
      { role: "user", content: rawMessage },
      ...(context?.lastRequest ? [{ role: "user", content: context.lastRequest }] : []),
    ],
  };
  const { added } = discoverRequestValues(databaseId, probe);
  if (added > 0) privacyMap = loadPrivacyMap(databaseId);

  const state = {
    request: privacyMap ? maskText(rawMessage, privacyMap) : rawMessage,
    lastRequest: context?.lastRequest && privacyMap ? maskText(context.lastRequest, privacyMap) : (context?.lastRequest ?? null),
    activeSkills: context?.activeSkills ?? [],
  };

  // ── Stage 1: tag choice over the capped tag vocabulary ────────────────────
  const tagCount = new Map<string, number>();
  for (const r of rules) for (const t of r.tags ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const tags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cfg.maxTags)
    .map(([t]) => t);

  let activeTags = new Set<string>();
  if (tags.length > 0) {
    const tagCriteria: Record<string, string> = {};
    for (const t of tags) tagCriteria[t] = t;
    const tagQuestions = { tag: { type: "choice", instructions: "Which topic tag best matches the user's request?", criteria: tagCriteria } } as Record<string, Question>;
    const t0 = Date.now();
    try {
      const { response } = await askClassifier(state, tagQuestions, { apiKey: key });
      await logAndFireJev({
        databaseId,
        sessionId: context?.sessionId,
        mode: context?.mode,
        phase: "rule-tags",
        questions: tagQuestions,
        state,
        answers: response.answers,
        model: response.model,
        usage: response.usage,
        durationMs: Date.now() - t0,
      });
      const tagAnswer = response.answers.tag as ChoiceAnswer;
      for (const [t, p] of Object.entries(tagAnswer.probabilities ?? {})) {
        if (p >= cfg.tagThreshold) activeTags.add(t);
      }
    } catch (err: any) {
      console.warn(`[vers_11] rule tag stage failed (falling back to keyword prefilter): ${err.message}`);
    }
  }

  // ── Stage 2: description choice over candidate rules ──────────────────────
  let candidates = rules;
  if (activeTags.size > 0) {
    const tagged = rules.filter((r) => (r.tags ?? []).some((t) => activeTags.has(t)));
    if (tagged.length > 0) candidates = tagged;
  }
  if (candidates.length > cfg.maxCandidates) {
    candidates = candidates
      .map((r) => ({ r, score: keywordScore(r, rawMessage) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, cfg.maxCandidates)
      .map((x) => x.r);
  }

  const byName = new Map(candidates.map((r) => [r.name, r]));
  const ruleCriteria: Record<string, string> = {};
  for (const r of candidates) ruleCriteria[r.name] = r.description || "(no description)";

  let ruleAnswer: ChoiceAnswer;
  const ruleQuestions = { rule: { type: "choice", instructions: "Which workspace rule applies to the user's request?", criteria: ruleCriteria } } as Record<string, Question>;
  const t1 = Date.now();
  try {
    const { response } = await askClassifier(state, ruleQuestions, { apiKey: key });
    await logAndFireJev({
      databaseId,
      sessionId: context?.sessionId,
      mode: context?.mode,
      phase: "rule-select",
      questions: ruleQuestions,
      state,
      answers: response.answers,
      model: response.model,
      usage: response.usage,
      durationMs: Date.now() - t1,
    });
    ruleAnswer = response.answers.rule as ChoiceAnswer;
  } catch (err: any) {
    console.warn(`[vers_11] rule description stage failed: ${err.message}`);
    return [];
  }

  const ranked = Object.entries(ruleAnswer.probabilities ?? {})
    .filter(([, p]) => p >= cfg.probThreshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, cfg.maxRules);

  const out: SelectedRule[] = [];
  for (const [name, prob] of ranked) {
    const r = byName.get(name);
    if (!r) continue;
    out.push({ name: r.name, description: r.description, content: r.content, prob });
  }
  return out;
}
