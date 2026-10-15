// Judge — the fan-out driver. Given a set of rows and a typed question, it
// sends one Classifier request per row (state = the row, one question),
// through a bounded concurrency pool with caching, and aggregates typed
// answers into a summary. Pure orchestration over the transport primitives.

import { noul, choice, score } from "./builders";
import { askClassifier } from "./openRouter";
import { runPool } from "./pool";
import { getCachedAnswers, setCachedAnswers } from "./cache";
import { loadPrivacyMap, loadPrivacyReverseMap } from "@backend/core/knowledge/index";
import { buildTextMasker, type TextMasker } from "@backend/core/knowledge/autoMask";
import type {
  Answer,
  ChoiceAnswer,
  InstructionValue,
  NoulAnswer,
  Question,
  ScoreAnswer,
} from "./types";

export type JudgeKind = "noul" | "choice" | "score";

export interface JudgeSpec {
  kind: JudgeKind;
  instructions: string;
  /** choice options / score levels. */
  options?: string[];
  questionId?: string;
}

export interface JudgeOptions {
  apiKey: string;
  concurrency?: number;
  model?: string;
  limit?: number;
  /** which columns of each row to include in the state (default: all). */
  columns?: string[];
  /** workspace id; when set, rows/questions are masked before send and the
   *  answers are unmasked on return (mirrors the LLM provider path). */
  databaseId?: string;
}

export interface JudgeRowResult {
  row: Record<string, unknown>;
  answer: Answer | null;
  confidence: number | null;
  ms: number;
  attempts: number;
  cached: boolean;
  error?: string;
}

export interface JudgeResult {
  kind: JudgeKind;
  summary: {
    total: number;
    counts: Record<string, number>;
    cached: number;
    latencyMs: number;
    /** True when the fan-out hit the hard timeout and returned partial rows. */
    timedOut?: boolean;
    /** Rows requested (vs `total` returned) when `timedOut` is true. */
    requested?: number;
  };
  rows: JudgeRowResult[];
}

function buildQuestion(spec: JudgeSpec): Question {
  if (spec.kind === "noul") return noul(spec.instructions);
  if (spec.kind === "choice") return choice(spec.instructions, spec.options ?? []);
  return score(spec.instructions, spec.options ?? []);
}

function pickState(row: Record<string, unknown>, columns?: string[]): unknown {
  if (!columns || columns.length === 0) return row;
  const out: Record<string, unknown> = {};
  for (const c of columns) if (c in row) out[c] = row[c];
  return out;
}

function answerConfidence(a: Answer): number | null {
  if (a.type === "choice") return (a as ChoiceAnswer).confidence;
  if (a.type === "score") return (a as ScoreAnswer).confidence;
  return null;
}

function answerLabel(spec: JudgeSpec, a: Answer): string {
  if (spec.kind === "noul") return (a as NoulAnswer).noul >= 0.5 ? "yes" : "no";
  if (spec.kind === "choice") return (a as ChoiceAnswer).choice;
  const s = a as ScoreAnswer;
  let best = Object.keys(s.probabilities)[0] ?? "";
  for (const k of Object.keys(s.probabilities)) {
    if ((s.probabilities[k] ?? 0) > (s.probabilities[best] ?? 0)) best = k;
  }
  return s.legend[best] ?? best;
}

// ── Privacy masking (mirrors the LLM provider path: mask on send, unmask on return) ──

/** Mask string leaves of an arbitrary value via the automated privacy map. */
function maskValues(masker: TextMasker, value: unknown): unknown {
  if (typeof value === "string") return masker.mask(value);
  if (Array.isArray(value)) return value.map((v) => maskValues(masker, v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskValues(masker, v);
    }
    return out;
  }
  return value;
}

/** Mask a typed question: instructions string leaves plus the criteria. Choice
 *  criteria keys (the options) are masked too, since they round-trip into the
 *  answer's `choice` / `probabilities` keys. */
export function maskQuestion(masker: TextMasker, q: Question): Question {
  const instructions = maskValues(masker, q.instructions) as InstructionValue;
  if (q.type === "noul") {
    const criteria = q.criteria
      ? {
          true: q.criteria.true !== undefined ? (maskValues(masker, q.criteria.true) as InstructionValue) : undefined,
          false: q.criteria.false !== undefined ? (maskValues(masker, q.criteria.false) as InstructionValue) : undefined,
        }
      : undefined;
    return { type: "noul", instructions, ...(criteria ? { criteria } : {}) };
  }
  if (q.type === "choice") {
    const criteria: Record<string, InstructionValue | null> = {};
    for (const [option, description] of Object.entries(q.criteria)) {
      criteria[masker.mask(option)] =
        description == null ? null : (maskValues(masker, description) as InstructionValue);
    }
    return { type: "choice", instructions, criteria };
  }
  return {
    type: "score",
    instructions,
    criteria: q.criteria.map((level) => maskValues(masker, level) as InstructionValue),
  };
}

/** Reverse stand-ins (fake → real) in an answer's free-text fields. */
function replaceReverse(text: string, reverse: Map<string, string>): string {
  let out = text;
  for (const [fake, real] of reverse) out = out.replaceAll(fake, real);
  return out;
}

export function unmaskAnswer(a: Answer, reverse: Map<string, string>): Answer {
  if (a.type === "choice") {
    const c = a as ChoiceAnswer;
    return {
      ...c,
      choice: replaceReverse(c.choice, reverse),
      probabilities: Object.fromEntries(
        Object.entries(c.probabilities).map(([k, v]) => [replaceReverse(k, reverse), v]),
      ),
    };
  }
  if (a.type === "score") {
    const s = a as ScoreAnswer;
    return {
      ...s,
      legend: Object.fromEntries(
        Object.entries(s.legend).map(([k, v]) => [k, replaceReverse(v, reverse)]),
      ),
    };
  }
  return a;
}

export async function judgeRows(
  rows: Record<string, unknown>[],
  spec: JudgeSpec,
  opts: JudgeOptions,
): Promise<JudgeResult> {
  const questionId = spec.questionId ?? "q";
  const question = buildQuestion(spec);
  const questions: Record<string, Question> = { [questionId]: question };

  const forward = opts.databaseId ? loadPrivacyMap(opts.databaseId) : null;
  const reverse = opts.databaseId ? loadPrivacyReverseMap(opts.databaseId) : null;
  const masker = forward ? buildTextMasker(forward) : null;
  const sentQuestions = masker
    ? (Object.fromEntries(
        Object.entries(questions).map(([id, q]) => [id, maskQuestion(masker, q)]),
      ) as Record<string, Question>)
    : questions;

  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, rows.length) : rows.length;
  const slice = rows.slice(0, limit);

  const t0 = Date.now();
  let cachedCount = 0;

  // Collect results as they complete (not necessarily in input order), so a
  // hard timeout can return the partial rows already judged instead of hanging
  // the whole workflow when the Classifier endpoint is slow or rate-limited.
  const out: JudgeRowResult[] = [];
  const JUDGE_TIMEOUT_MS = 30000;

  await Promise.race([
    runPool(
      slice,
      opts.concurrency ?? 4,
      async (row) => {
        const maskedRow = masker
          ? (maskValues(masker, row) as Record<string, unknown>)
          : row;
        const state = pickState(maskedRow, opts.columns);
        const cached = getCachedAnswers(state, sentQuestions);
        if (cached) {
          cachedCount++;
          const raw = cached[questionId];
          return {
            row: maskedRow,
            answer: raw && reverse ? unmaskAnswer(raw, reverse) : raw,
            confidence: raw ? answerConfidence(raw) : null,
            ms: 0,
            attempts: 0,
            cached: true,
          } as JudgeRowResult;
        }
        try {
          const { response, ms, attempts } = await askClassifier(state, sentQuestions, {
            apiKey: opts.apiKey,
            model: opts.model,
          });
          const answers = response.answers ?? {};
          setCachedAnswers(state, sentQuestions, answers);
          const raw = answers[questionId];
          return {
            row: maskedRow,
            answer: raw ? (reverse ? unmaskAnswer(raw, reverse) : raw) : null,
            confidence: raw ? answerConfidence(raw) : null,
            ms,
            attempts,
            cached: false,
          } as JudgeRowResult;
        } catch (e) {
          return {
            row: maskedRow,
            answer: null,
            confidence: null,
            ms: 0,
            attempts: 0,
            cached: false,
            error: (e as Error).message,
          } as JudgeRowResult;
        }
      },
      (result) => out.push(result),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, JUDGE_TIMEOUT_MS)),
  ]);

  const counts: Record<string, number> = {};
  for (const r of out) {
    if (!r.answer) continue;
    const label = answerLabel(spec, r.answer);
    counts[label] = (counts[label] ?? 0) + 1;
  }

  const timedOut = out.length < slice.length;
  return {
    kind: spec.kind,
    summary: {
      total: out.length,
      counts,
      cached: cachedCount,
      latencyMs: Date.now() - t0,
      ...(timedOut ? { timedOut: true, requested: slice.length } : {}),
    },
    rows: out,
  };
}

// ── Dataset-level checks ─────────────────────────────────────────────────────
// A cheaper alternative to `judgeRows` when the question is about the DATASET as
// a whole ("are any rows missing a GL Account?") rather than about each row.
// Sends the whole (masked) table as a single state and asks every check as a
// `noul` in ONE Classifier call — one request instead of one-per-row.

export interface CheckSpec {
  /** Short stable id (snake_case), used to key the returned answers. */
  id: string;
  /** A yes/no question about the dataset as a whole. */
  question: string;
}

export interface CheckResult {
  id: string;
  /** 0..1 — how strongly the Classifier answered yes. Null on transport error. */
  noul: number | null;
  error?: string;
}

export interface CheckOptions {
  apiKey: string;
  model?: string;
  /** Workspace id; when set, rows and questions are masked before send. */
  databaseId?: string;
  /** Cap on rows sent as state (defaults to all). */
  limit?: number;
}

export async function checkDataset(
  rows: Record<string, unknown>[],
  checks: CheckSpec[],
  opts: CheckOptions,
): Promise<CheckResult[]> {
  if (checks.length === 0) return [];

  const forward = opts.databaseId ? loadPrivacyMap(opts.databaseId) : null;
  const masker = forward ? buildTextMasker(forward) : null;

  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, rows.length) : rows.length;
  const slice = rows.slice(0, limit);

  const state = masker
    ? (maskValues(masker, { table: slice }) as Record<string, unknown>)
    : { table: slice };

  const questions: Record<string, Question> = {};
  for (const c of checks) {
    const q = noul(c.question);
    questions[c.id] = masker ? maskQuestion(masker, q) : q;
  }

  try {
    const { response } = await askClassifier(state, questions, {
      apiKey: opts.apiKey,
      model: opts.model,
    });
    return checks.map((c) => {
      const a = response.answers[c.id] as NoulAnswer | undefined;
      return { id: c.id, noul: a ? a.noul : null };
    });
  } catch (e) {
    return checks.map((c) => ({ id: c.id, noul: null, error: (e as Error).message }));
  }
}
