/**
 * Type definitions for the TypeSafe Classifier API (native Jev).
 *
 * Jev is a structured-decision model, not a chat model: you send a `state` and
 * typed `questions`, and get back typed `answers` (probabilities + confidence),
 * with no text generation and no tool calls.
 *
 * See https://docs.typesafe.ai/api
 */

export type QuestionType = "noul" | "choice" | "score";

/** A value allowed in `instructions` / `criteria` fields. */
export type InstructionValue = string | Record<string, unknown> | unknown[];

export interface NoulQuestion {
  type: "noul";
  instructions: InstructionValue;
  criteria?: { true?: InstructionValue; false?: InstructionValue };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: InstructionValue;
  /** option → rubric description (null when an option needs no detail). */
  criteria: Record<string, InstructionValue | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: InstructionValue;
  /** Ordered level descriptions (2–10 levels). */
  criteria: InstructionValue[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface ClassifierResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}
