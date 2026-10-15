/**
 * Consolidated Jev (TypeSafe "Classifier") front-door router.
 *
 * One batched call classifies the whole request: whether it needs a tool, which
 * skill best matches, whether it mutates anything, and how complex it is. Tools
 * are deliberately NOT in the routing prompt — they are derived deterministically
 * from the selected skills' `## Tools needed` (tools follow skills), which keeps
 * the routing prompt small (skills + a handful of lightweight nouls).
 */

import { loadAppSkills } from "../../core/skills/loader";
import { askClassifier } from "@shared/typesafe/openRouter";
import type { ChoiceAnswer, NoulAnswer, ScoreAnswer, Question } from "@shared/typesafe/types";
import { getClassifierKey } from "@backend/core/user/getLLMApiKey";
import { writeLog } from "@backend/core/workspace/logs";
import { fireLogHook } from "@backend/core/llm/providers";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { maskText, discoverRequestValues } from "@backend/core/knowledge/autoMask";
import { maskCallOptions } from "@backend/core/models/privacyMask";

// ── Thresholds ───────────────────────────────────────────────────────────────
export const ROUTE_CONFIG = {
  skillProbThreshold: 0.15,
  maxSkills: 3,
};

export interface Ranked {
  name: string;
  prob: number;
}

export interface RouteDecision {
  needsTool: number;
  mutating: number;
  complexity: number;
  followUp: number;
  selectedSkills: string[];
  skills: Ranked[];
  skillSummary: string;
}

function skillRoster(databaseId: string) {
  return loadAppSkills(databaseId).filter(
    (s) => !s.scope || s.scope === "chat" || s.scope === "chat+workflow",
  );
}

/** Explicit `/skillname` mention always wins, mirroring vers_6's router rule. */
function explicitMention(
  rawMessage: string,
  skills: { name: string }[],
): string | null {
  const m = rawMessage.match(/^\/(\S+)/);
  if (!m) return null;
  const name = m[1];
  return skills.some((s) => s.name === name) ? name : null;
}

/** Prior-turn context, sent to Jev as `state` so it can route follow-ups. */
export interface RouteContext {
  lastRequest?: { tool: string; params: Record<string, unknown>; rawMessage: string };
  lastTool?: string;
  activeSkills?: string[];
  sessionId?: string;
  mode?: string;
}

export async function route(
  databaseId: string,
  userId: string,
  rawMessage: string,
  context?: RouteContext,
): Promise<RouteDecision> {
  const skills = skillRoster(databaseId);
  const explicit = explicitMention(rawMessage, skills);

  const key = await getClassifierKey(userId);

  const skillCriteria: Record<string, string> = {};
  for (const s of skills) skillCriteria[s.name] = s.description || "(no description)";

  const state = {
    request: rawMessage,
    lastRequest: context?.lastRequest?.rawMessage ?? null,
    lastTool: context?.lastTool ?? null,
    activeSkills: context?.activeSkills ?? [],
  };

  const questions: Record<string, Question> = {
    needs_tool: {
      type: "noul",
      instructions:
        "Does this request need to call a tool or run a workflow, rather than being answerable in prose?",
    },
    skill: {
      type: "choice",
      instructions: "Which skill best matches the user's request?",
      criteria: skillCriteria,
    },
    mutating: {
      type: "noul",
      instructions:
        "Does this request create, produce, save, modify, delete, send, download, or deliver anything (data, a file, a report, an email, a workflow, a message), rather than only reading or querying existing information?",
    },
    complexity: {
      type: "score",
      instructions: "How complex is this request to resolve?",
      criteria: [
        "Simple lookup or a single tool call",
        "Requires judgment or multiple steps",
        "Unusual, ambiguous, or needs escalation",
      ],
    },
    follow_up: {
      type: "noul",
      instructions:
        "Is this a follow-up to the previous request (e.g. 'by month', 'instead', 'what about', 'now do it this way') rather than a fresh task?",
    },
  };

  // ── Privacy masking (Option A) ──────────────────────────────────────────
  // Mask only the user-derived text; skill names (criteria) stay as-is so
  // Jev's choice answers key off real names and need no unmasking.
  let privacyMap = loadPrivacyMap(databaseId);

  const probe = {
    system: "",
    messages: [
      { role: "user", content: rawMessage },
      ...(state.lastRequest ? [{ role: "user", content: state.lastRequest }] : []),
    ],
  };
  const { added } = discoverRequestValues(databaseId, probe);
  if (added > 0) privacyMap = loadPrivacyMap(databaseId);

  const sentState = privacyMap
    ? {
        ...state,
        request: maskText(state.request, privacyMap),
        lastRequest: state.lastRequest ? maskText(state.lastRequest, privacyMap) : null,
      }
    : state;

  const startTime = Date.now();
  const { response: resp } = await askClassifier(sentState, questions, { apiKey: key });

  const needsTool = (resp.answers.needs_tool as NoulAnswer).noul;
  const mutating = (resp.answers.mutating as NoulAnswer).noul;
  const complexity = (resp.answers.complexity as ScoreAnswer).score;
  const followUp = (resp.answers.follow_up as NoulAnswer).noul;
  const skillAnswer = resp.answers.skill as ChoiceAnswer;

  // ── Log the Jev call (structured decision) ──────────────────────────
  if (context?.sessionId) {
    try {
      let maskedSystemPrompt: string | undefined;
      let maskedMessages: Array<{ role: string; content: string }> | undefined;
      let substitutionCount = 0;

      if (privacyMap) {
        const masked = maskCallOptions(
          { system: undefined, messages: [{ role: "user", content: JSON.stringify(state, null, 2) }] },
          privacyMap,
        );
        maskedSystemPrompt = JSON.stringify(questions, null, 2);
        maskedMessages = (masked.opts.messages as any[]).map((m: any) => ({
          role: typeof m.role === "string" ? m.role : "unknown",
          content:
            typeof m.content === "string" ? m.content : String(m.content ?? ""),
        }));
        substitutionCount = masked.substitutionCount;
      }

      const entry = {
        id: crypto.randomUUID(),
        sessionId: context.sessionId,
        provider: "openrouter_jev",
        model: resp.model || "jev-latest",
        mode: context.mode ?? "build",
        kind: "jev",
        durationMs: Date.now() - startTime,
        systemPrompt: JSON.stringify(questions, null, 2),
        messages: [{ role: "user", content: JSON.stringify(state, null, 2) }],
        responseText: JSON.stringify(resp.answers, null, 2),
        inputTokens: resp.usage?.input_tokens,
        outputTokens: resp.usage?.output_tokens,
        toolCalls: [],
        success: true,
        created_at: new Date().toISOString(),
        maskedSystemPrompt,
        maskedMessages,
        substitutionCount,
      };
      writeLog(databaseId, entry as any);
      await fireLogHook({
        logId: entry.id,
        provider: "openrouter_jev",
        model: entry.model,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        phase: "routing",
        kind: "jev",
      });
    } catch (err: any) {
      console.warn("[vers_8] Failed to log Jev call:", err.message);
    }
  }

  const rankedSkills: Ranked[] = Object.entries(skillAnswer?.probabilities ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, prob]) => ({ name, prob }));

  const selectedSkills = (explicit ? [{ name: explicit, prob: 1 }] : rankedSkills)
    .filter((r) => r.prob >= ROUTE_CONFIG.skillProbThreshold)
    .slice(0, ROUTE_CONFIG.maxSkills)
    .map((r) => r.name);

  const skillSummary = rankedSkills
    .slice(0, 3)
    .map((r) => `${r.name} (${r.prob.toFixed(2)})`)
    .join(", ");

  return {
    needsTool,
    mutating,
    complexity,
    followUp,
    selectedSkills,
    skills: rankedSkills,
    skillSummary,
  };
}
