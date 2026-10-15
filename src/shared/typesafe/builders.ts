// Typed question builders for the Classifier API (noul / choice / score).
// Pure — shared by any caller that wants to build a typed `questions` map.

import type {
  ChoiceQuestion,
  NoulQuestion,
  ScoreQuestion,
} from "./types";

export function noul(instructions: string, criteria?: { true?: string; false?: string }): NoulQuestion {
  return { type: "noul", instructions, ...(criteria ? { criteria } : {}) };
}

export function choice(instructions: string, options: string[]): ChoiceQuestion {
  return {
    type: "choice",
    instructions,
    criteria: Object.fromEntries(options.map((o) => [o, null])),
  };
}

export function score(instructions: string, levels: string[]): ScoreQuestion {
  return { type: "score", instructions, criteria: levels };
}
