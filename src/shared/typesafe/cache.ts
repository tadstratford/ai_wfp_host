// In-memory answer cache keyed by a SHA1 of `(state, questions)`. Re-judging
// the same row (re-interpreting a header, editing unrelated cells) costs zero
// requests. Process-local; cleared on restart.

import { createHash } from "node:crypto";
import type { Answer, Question } from "./types";

const store = new Map<string, Answer[]>();

export function cacheKey(state: unknown, questions: Record<string, Question>): string {
  return createHash("sha1").update(JSON.stringify({ state, questions })).digest("hex");
}

/** Look up previously cached answers (array parallel to the question ids). */
export function getCachedAnswers(
  state: unknown,
  questions: Record<string, Question>,
): Record<string, Answer> | null {
  const key = cacheKey(state, questions);
  const ids = Object.keys(questions);
  const values = store.get(key);
  if (!values || values.length !== ids.length) return null;
  const out: Record<string, Answer> = {};
  ids.forEach((id, i) => (out[id] = values[i]));
  return out;
}

export function setCachedAnswers(
  state: unknown,
  questions: Record<string, Question>,
  answers: Record<string, Answer>,
): void {
  const key = cacheKey(state, questions);
  const ids = Object.keys(questions);
  store.set(key, ids.map((id) => answers[id]));
}

export function cacheSize(): number {
  return store.size;
}

export function clearCache(): void {
  store.clear();
}
