import { describe, it, expect } from "bun:test";
import { runClassifierRuleAudit, runStreamRuleAudit } from "./classifierAudit";
import type { SuccessFactor } from "./successFactors";

const factors: SuccessFactor[] = [
  { mode: "deterministic", condition: "The total equals 100" },
  { mode: "audit", condition: "The report is clear" },
];

function fakeFetch(nouls: Record<string, number>): typeof fetch {
  return (async () => {
    const answers = Object.fromEntries(
      Object.entries(nouls).map(([k, n]) => [k, { type: "noul", noul: n }]),
    );
    return new Response(
      JSON.stringify({
        model: "jev-test",
        answers,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

describe("runClassifierRuleAudit", () => {
  it("passes when every rule scores above threshold", async () => {
    const report = await runClassifierRuleAudit({
      factors,
      subject: "some output",
      apiKey: "test-key",
      fetchImpl: fakeFetch({ rule_0: 0.9, rule_1: 0.7 }),
    });
    expect(report.verdict).toBe("pass");
    expect(report.summary).toEqual({ total: 2, passed: 2, failed: 0 });
  });

  it("fails when any rule scores below threshold", async () => {
    const report = await runClassifierRuleAudit({
      factors,
      subject: "some output",
      apiKey: "test-key",
      fetchImpl: fakeFetch({ rule_0: 0.9, rule_1: 0.1 }),
    });
    expect(report.verdict).toBe("failed");
    expect(report.summary.failed).toBe(1);
    expect(report.factors[1].result).toBe("fail");
  });

  it("fails closed when the classifier call throws", async () => {
    const throwingFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const report = await runClassifierRuleAudit({
      factors,
      subject: "some output",
      apiKey: "test-key",
      fetchImpl: throwingFetch,
      maxAttempts: 1,
    });
    expect(report.verdict).toBe("failed");
    expect(report.summary.failed).toBe(2);
  });
});

function streamFetch(opts: {
  ruleViolated?: number;
  presented?: number;
}): typeof fetch {
  return (async () => {
    const answers: Record<string, unknown> = {
      rule_0: { type: "noul", noul: opts.ruleViolated ?? 0 },
      presented_violated: { type: "noul", noul: opts.presented ?? 0 },
    };
    return new Response(
      JSON.stringify({
        model: "jev-test",
        answers,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

describe("runStreamRuleAudit", () => {
  const rules = [
    { name: "travel-sales", content: "Travel is booked to sales." },
  ];
  const presented = "Schedule payables by due date.";

  it("reports no_errors when no rule is violated", async () => {
    const report = await runStreamRuleAudit({
      workspaceRules: rules,
      presentedRules: presented,
      stream: "some output",
      apiKey: "test-key",
      fetchImpl: streamFetch({ ruleViolated: 0, presented: 0 }),
    });
    expect(report.statusReason).toBe("no_errors");
    expect(report.failedRule).toBeNull();
  });

  it("reports broke_workspace_rule when a workspace rule is violated", async () => {
    const report = await runStreamRuleAudit({
      workspaceRules: rules,
      presentedRules: presented,
      stream: "some output",
      apiKey: "test-key",
      fetchImpl: streamFetch({ ruleViolated: 0.9, presented: 0 }),
    });
    expect(report.statusReason).toBe("broke_workspace_rule");
    expect(report.failedRule).toBe("travel-sales");
  });

  it("reports broke_presented_rule when only the presented rules are violated", async () => {
    const report = await runStreamRuleAudit({
      workspaceRules: rules,
      presentedRules: presented,
      stream: "some output",
      apiKey: "test-key",
      fetchImpl: streamFetch({ ruleViolated: 0, presented: 0.9 }),
    });
    expect(report.statusReason).toBe("broke_presented_rule");
    expect(report.failedRule).toBeNull();
  });

  it("fails closed (broke_workspace_rule) when the classifier throws", async () => {
    const throwingFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const report = await runStreamRuleAudit({
      workspaceRules: rules,
      presentedRules: presented,
      stream: "some output",
      apiKey: "test-key",
      fetchImpl: throwingFetch,
    });
    expect(report.statusReason).toBe("broke_workspace_rule");
    expect(report.failedRule).toBeNull();
  });
});
