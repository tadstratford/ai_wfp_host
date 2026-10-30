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
import { declaredTools } from "../../core/skills/loader";
import { askClassifier } from "@shared/typesafe/openRouter";
import type { ChoiceAnswer, Question } from "@shared/typesafe/types";
import { getClassifierKey } from "@backend/core/user/getLLMApiKey";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { maskText, discoverRequestValues } from "@backend/core/knowledge/autoMask";
import { logAndFireJev } from "../jevLog";
import type { SelectedRule } from "./types";
import { loadConfig } from "./config";

/** Sentinel option in the rule-select choice. A `choice` question normalizes its
 *  probabilities to sum to 1, so a single candidate rule is always scored ~1.0
 *  even when it is irrelevant. This option gives Jev a real "none applies" out,
 *  so an unrelated request (e.g. "review the audit data") doesn't force the
 *  allocation rule. The sentinel is never returned as a selected rule. */
const NO_RULE_KEY = "__no_rule_applies__";

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

/** A rule candidate with its relevance score, for the rule-selection thinking
 *  card (options shown before the outcome). */
export interface RuleOption {
  name: string;
  description?: string;
  prob: number;
}

export interface RuleSelection {
  /** Rules that cleared the probability threshold (the "applying" rules). */
  selected: SelectedRule[];
  /** The full ranked candidate list (name + description + prob), for display. */
  options: RuleOption[];
}

export async function selectRules(
  databaseId: string,
  userId: string,
  rawMessage: string,
  context?: RuleSelectionContext,
): Promise<RuleSelection> {
  const rules = loadRules(databaseId);
  if (rules.length === 0) return { selected: [], options: [] };

  const cfg = loadConfig().rules;

  let key: string;
  try {
    key = await getClassifierKey(userId);
  } catch {
    return { selected: [], options: [] }; // no classifier key — rules are an enhancement, not a hard dependency
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
  ruleCriteria[NO_RULE_KEY] = "None of these rules apply — the request is unrelated to any workspace rule.";

  let ruleAnswer: ChoiceAnswer;
  const ruleQuestions = { rule: { type: "choice", instructions: "Which workspace rule applies to the user's request? Choose the rule that genuinely applies, or choose the 'no rule applies' option when the request is unrelated to any rule.", criteria: ruleCriteria } } as Record<string, Question>;
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
    return { selected: [], options: [] };
  }

  const ranked = Object.entries(ruleAnswer.probabilities ?? {})
    .filter(([name, p]) => name !== NO_RULE_KEY && p >= cfg.probThreshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, cfg.maxRules);

  const out: SelectedRule[] = [];
  for (const [name, prob] of ranked) {
    const r = byName.get(name);
    if (!r) continue;
    out.push({ name: r.name, description: r.description, content: r.content, tools: ruleTools(r), prob });
  }

  // Full candidate list for the thinking card (unfiltered by threshold).
  const options: RuleOption[] = Object.entries(ruleAnswer.probabilities ?? {})
    .filter(([name]) => name !== NO_RULE_KEY && byName.has(name))
    .map(([name, prob]) => ({ name, description: byName.get(name)?.description, prob }))
    .sort((a, b) => b.prob - a.prob);

  return { selected: out, options };
}

/** The rule's tool references: structured when present, else derived once from
 *  the legacy `## Tools needed` markdown (read-time migration — no write). */
function ruleTools(r: { content: string; tools?: { name: string; role?: string }[] }): { name: string; role?: string }[] | undefined {
  if (r.tools && r.tools.length > 0) return r.tools;
  const legacy = declaredTools(r.content);
  return legacy.length > 0 ? legacy.map((n) => ({ name: n })) : undefined;
}
