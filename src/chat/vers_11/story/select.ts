/**
 * story selection — the Jev step that picks the meta-plan (archetype).
 *
 * One fan-out classify call asks every archetype's noul ("is this the audit
 * story?", "is this the quick-fact story?") and picks the highest-scoring one
 * above the configured threshold. Selection only — running the story's beats is
 * a later phase; here the result is recorded in the plan's provenance.
 *
 * Stories come from the markdown catalog (`src/core/stories/*.md`), loaded via
 * `loadStories()`. Mirrors the `SHAPES` classifier and skill routing: state is
 * privacy-masked, the call is logged via `logAndFireJev`, and no archetype
 * clearing the threshold yields `null` (current single-shot behavior).
 */

import { askClassifier } from "@shared/typesafe/openRouter";
import type { NoulAnswer, Question } from "@shared/typesafe/types";
import { getClassifierKey } from "@backend/core/user/getLLMApiKey";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { maskText, discoverRequestValues } from "@backend/core/knowledge/autoMask";
import { logAndFireJev } from "../../jevLog";
import { loadConfig } from "../config";
import { loadStories } from "../../../core/stories/loader";
import type { StoryArchetype } from "wfp-format/story";

export interface RankedArchetype {
  id: string;
  description: string;
  prob: number;
}

export interface StoryDecision {
  /** The winning archetype, or null when none cleared the threshold. */
  archetype: StoryArchetype | null;
  /** Full ranked distribution (for the thinking stream). */
  options: RankedArchetype[];
  /** "id (prob)" summary of the top three. */
  summary: string;
}

export async function selectArchetype(
  databaseId: string,
  userId: string,
  rawMessage: string,
  opts: { sessionId?: string; mode?: string },
): Promise<StoryDecision> {
  const stories = loadStories();
  if (stories.length === 0) {
    return { archetype: null, options: [], summary: "" };
  }

  const key = await getClassifierKey(userId);

  let privacyMap = loadPrivacyMap(databaseId);
  const probe = { system: "", messages: [{ role: "user", content: rawMessage }] };
  const { added } = discoverRequestValues(databaseId, probe);
  if (added > 0) privacyMap = loadPrivacyMap(databaseId);

  const state = {
    request: privacyMap ? maskText(rawMessage, privacyMap) : rawMessage,
  };

  // One noul per archetype (fan-out) — the same pattern as SHAPES.classify().
  const questions: Record<string, Question> = {};
  for (const a of stories) {
    for (const [id, instructions] of Object.entries(a.nouls)) {
      questions[id] = { type: "noul", instructions };
    }
  }

  const t0 = Date.now();
  const { response } = await askClassifier(state, questions, { apiKey: key });
  await logAndFireJev({
    databaseId,
    sessionId: opts.sessionId,
    mode: opts.mode,
    phase: "story-archetype",
    questions,
    state,
    answers: response.answers,
    model: response.model,
    usage: response.usage,
    durationMs: Date.now() - t0,
  });

  // An archetype may declare several nouls; score it by its strongest answer.
  const ranked = stories
    .map((a) => {
      const probs = Object.keys(a.nouls).map(
        (id) => (response.answers[id] as NoulAnswer | undefined)?.noul ?? 0,
      );
      return { id: a.id, description: a.description, prob: Math.max(0, ...probs) };
    })
    .sort((x, y) => y.prob - x.prob);

  const cfg = loadConfig().story;
  const options: RankedArchetype[] = ranked.map((r) => ({
    id: r.id,
    description: r.description,
    prob: r.prob,
  }));

  const top = ranked
    .filter((r) => r.prob >= cfg.archetypeProbThreshold)
    .slice(0, cfg.maxArchetypes)
    .map((r) => r.id);

  const archetype = top.length > 0 ? stories.find((a) => a.id === top[0]) ?? null : null;
  const summary = ranked
    .slice(0, 3)
    .map((r) => `${r.id} (${r.prob.toFixed(2)})`)
    .join(", ");

  return { archetype, options, summary };
}
