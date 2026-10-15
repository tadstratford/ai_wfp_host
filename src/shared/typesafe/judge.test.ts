import { describe, expect, test } from "bun:test";
import { noul, choice, score } from "./builders";
import { runPool } from "./pool";
import { cacheKey, getCachedAnswers, setCachedAnswers } from "./cache";
import type { Answer } from "./types";

describe("builders", () => {
  test("noul / choice / score produce the typed question shapes", () => {
    expect(noul("Is this urgent?")).toEqual({ type: "noul", instructions: "Is this urgent?" });
    expect(choice("Which team?", ["a", "b"])).toEqual({
      type: "choice",
      instructions: "Which team?",
      criteria: { a: null, b: null },
    });
    expect(score("How frustrated?", ["Calm", "Angry"])).toEqual({
      type: "score",
      instructions: "How frustrated?",
      criteria: ["Calm", "Angry"],
    });
  });
});

describe("pool", () => {
  test("runs items concurrently and returns all results", async () => {
    const order: number[] = [];
    const results = await runPool([1, 2, 3, 4, 5], 3, async (n) => {
      await new Promise((r) => setTimeout(r, n % 2 === 0 ? 10 : 5));
      return n * 2;
    });
    expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
  });
});

describe("cache", () => {
  test("round-trips answers keyed by (state, questions)", () => {
    const state = { memo: "hello" };
    const questions = { q: noul("match?") };
    const answers: Record<string, Answer> = { q: { type: "noul", noul: 0.9 } };

    expect(getCachedAnswers(state, questions)).toBeNull();
    setCachedAnswers(state, questions, answers);
    expect(getCachedAnswers(state, questions)).toEqual(answers);

    // Different state → miss.
    expect(getCachedAnswers({ memo: "other" }, questions)).toBeNull();
  });

  test("cacheKey is deterministic and differs by input", () => {
    expect(cacheKey({ a: 1 }, { q: noul("x?") })).toBe(cacheKey({ a: 1 }, { q: noul("x?") }));
    expect(cacheKey({ a: 1 }, { q: noul("x?") })).not.toBe(cacheKey({ a: 2 }, { q: noul("x?") }));
  });
});
