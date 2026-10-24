import { describe, expect, test } from "bun:test";
import { summarizeEntries, summarizeSummaries, ENTRIES_PER_SUMMARY, SUMMARIES_PER_NARRATIVE } from "./compaction";
import type { DiaryEntry, DiarySummary } from "wfp-format";

function entry(i: number, overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: `e${i}`,
    eventAt: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    actor: "alice",
    summary: `entry ${i}`,
    ...overrides,
  };
}

describe("summarizeEntries", () => {
  test("aggregates actors, entities, capabilities, totals, and keeps a sample", () => {
    const entries = [
      entry(1, { actor: "alice", producer: "app-a", entities: ["Maintenance"], amount: 10 }),
      entry(2, { actor: "bob", producer: "app-a", entities: ["Maintenance"], amount: 20 }),
      entry(3, { actor: "alice", producer: "app-b", entities: ["Fund Alpha"], amount: 5 }),
    ];
    const s = summarizeEntries(entries);
    expect(s.count).toBe(3);
    expect(s.byActor).toEqual({ alice: 2, bob: 1 });
    expect(s.byEntity).toEqual({ Maintenance: 2, "Fund Alpha": 1 });
    expect(s.byCapability).toEqual({ "app-a": 2, "app-b": 1 });
    expect(s.totals).toEqual({ amount: 35 });
    expect(s.sample.length).toBe(3);
    expect(s.highlights).toEqual([]);
    expect(s.batchHash).toBeTruthy();
  });

  test("omits totals when no amounts are present", () => {
    const s = summarizeEntries([entry(1), entry(2)]);
    expect(s.totals).toBeUndefined();
  });
});

describe("summarizeSummaries", () => {
  test("rolls summaries into a narrative chunk", () => {
    const summaries: DiarySummary[] = [
      { id: "s1", from: "2026-01", to: "2026-01", count: 60, batchHash: "h1", byActor: {}, byEntity: {}, byCapability: {}, sample: [], highlights: [] },
      { id: "s2", from: "2026-02", to: "2026-02", count: 60, batchHash: "h2", byActor: {}, byEntity: {}, byCapability: {}, sample: [], highlights: [] },
    ];
    const n = summarizeSummaries(summaries);
    expect(n.count).toBe(2);
    expect(n.from).toBe("2026-01");
    expect(n.to).toBe("2026-02");
    expect(n.batchHash).toBeTruthy();
    expect(n.highlights).toEqual([]);
  });
});

describe("compaction thresholds", () => {
  test("constants match the agreed cadence", () => {
    expect(ENTRIES_PER_SUMMARY).toBe(60);
    expect(SUMMARIES_PER_NARRATIVE).toBe(20);
  });
});
