import { describe, expect, test } from "bun:test";
import { buildTextMasker } from "@backend/core/knowledge/autoMask";
import { choice, noul, score } from "./builders";
import { maskQuestion, unmaskAnswer } from "./judge";
import type { Answer } from "./types";

const masker = buildTextMasker(
  new Map([
    ["Acme Corp", "Fake Inc"],
    ["Doe", "Roe"],
  ]),
);
const reverse = new Map([
  ["Fake Inc", "Acme Corp"],
  ["Roe", "Doe"],
]);

describe("maskQuestion", () => {
  test("masks choice criteria keys (options) and instructions", () => {
    const q = choice("Is this row for Acme Corp?", ["Acme Corp", "Other"]);
    const m = maskQuestion(masker, q) as any;
    expect(m.type).toBe("choice");
    expect(m.instructions).toBe("Is this row for Fake Inc?");
    expect(Object.keys(m.criteria)).toEqual(["Fake Inc", "Other"]);
  });

  test("masks score criteria (level) values", () => {
    const q = score("rate Acme Corp", ["Low", "High Acme Corp"]);
    const m = maskQuestion(masker, q) as any;
    expect(m.criteria).toEqual(["Low", "High Fake Inc"]);
  });

  test("noul masks instructions and criteria values", () => {
    const q = noul("Acme Corp present?", { true: "yes Acme Corp", false: "no" });
    const m = maskQuestion(masker, q) as any;
    expect(m.instructions).toBe("Fake Inc present?");
    expect(m.criteria).toEqual({ true: "yes Fake Inc", false: "no" });
  });
});

describe("unmaskAnswer", () => {
  test("reverses choice.choice and probabilities keys", () => {
    const a: Answer = {
      type: "choice",
      choice: "Fake Inc",
      probabilities: { "Fake Inc": 0.9, Other: 0.1 },
      confidence: 0.9,
    };
    const out = unmaskAnswer(a, reverse) as any;
    expect(out.choice).toBe("Acme Corp");
    expect(out.probabilities).toEqual({ "Acme Corp": 0.9, Other: 0.1 });
  });

  test("reverses score legend values", () => {
    const a: Answer = {
      type: "score",
      score: 1,
      legend: { "0": "Low", "1": "High Fake Inc" },
      probabilities: { "0": 0.2, "1": 0.8 },
      confidence: 0.8,
    };
    const out = unmaskAnswer(a, reverse) as any;
    expect(out.legend).toEqual({ "0": "Low", "1": "High Acme Corp" });
  });

  test("noul is untouched", () => {
    const a: Answer = { type: "noul", noul: 0.7 };
    expect(unmaskAnswer(a, reverse)).toEqual(a);
  });
});
