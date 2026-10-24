import { describe, expect, test } from "bun:test";
import { WorkspaceSession } from "../WorkspaceSession";

function makeSession(): WorkspaceSession {
  return new WorkspaceSession({
    userId: "u1",
    workspaceId: "ws1",
    wfp: { metadata: { format_version: "1.0.0", workspace: "T" }, workflows: [] },
    secret: null,
  });
}

describe("diary", () => {
  test("60 entries roll into one summary", () => {
    const s = makeSession();
    for (let i = 0; i < 60; i++) s.recordDiaryEntry({ summary: `entry ${i}` });
    const diary = s.getDiary();
    expect(diary.entries.length).toBe(0);
    expect(diary.summaries.length).toBe(1);
    expect(diary.summaries[0].count).toBe(60);
  });

  test("data load (new entry) records a diary entry with stats", () => {
    const s = makeSession();
    s.setDataEntry("ap", { content: "a,b", content_type: "csv", row_count: 100, columns: ["a", "b"] });
    const diary = s.getDiary();
    expect(diary.entries.length).toBe(1);
    expect(diary.entries[0].summary).toContain("ap");
    expect(diary.entries[0].summary).toContain("100 rows");
  });

  test("updating an existing data entry does not record another diary entry", () => {
    const s = makeSession();
    s.setDataEntry("ap", { content: "a,b", content_type: "csv" });
    s.setDataEntry("ap", { content: "a,b,c", content_type: "csv" });
    expect(s.getDiary().entries.length).toBe(1);
  });

  test("rule add / update / delete all record diary entries", () => {
    const s = makeSession();
    s.upsertRule({ name: "r1", content: "x" });
    s.upsertRule({ name: "r1", content: "y" });
    s.deleteRule("r1");
    const summaries = s.getDiary().entries.map((e) => e.summary);
    expect(summaries).toEqual(['Added rule "r1"', 'Updated rule "r1"', 'Deleted rule "r1"']);
  });

  test("updateDiaryEntrySummary replaces an entry's summary", () => {
    const s = makeSession();
    const id = s.recordDiaryEntry({ summary: "initial" });
    expect(s.updateDiaryEntrySummary(id, "LLM description")).toBe(true);
    expect(s.getDiary().entries[0].summary).toBe("LLM description");
  });
});
