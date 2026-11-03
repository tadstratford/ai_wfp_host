import { describe, it, expect } from "bun:test";
import { loadStories } from "./loader";

describe("story loader", () => {
  it("loads the shipped story archetypes from markdown", () => {
    const stories = loadStories();
    const ids = stories.map((s) => s.id);
    expect(ids).toContain("audit-review");
    expect(ids).toContain("quick-fact");
    expect(ids).toContain("report");
    expect(ids).toContain("generic");
  });

  it("audit-review is the full seven-beat arc with one gated write", () => {
    const ar = loadStories().find((s) => s.id === "audit-review")!;
    expect(ar.beats.map((b) => b.id)).toEqual([
      "persona", "setup", "status", "gap", "plan", "execute", "resolution",
    ]);
    expect(ar.beats.filter((b) => b.write).map((b) => b.id)).toEqual(["execute"]);
  });

  it("quick-fact and report are two-beat short paths without a write", () => {
    for (const id of ["quick-fact", "report"]) {
      const s = loadStories().find((x) => x.id === id)!;
      expect(s.beats.map((b) => b.id)).toEqual(["setup", "resolution"]);
      expect(s.beats.some((b) => b.write)).toBe(false);
    }
  });

  it("the generic catch-all has a clarify beat and a skill-less resolve beat", () => {
    const g = loadStories().find((s) => s.id === "generic")!;
    expect(g.beats[0].id).toBe("clarify");
    expect(g.beats[0].skills).toEqual(["clarify"]);
    expect(g.beats[1].skills).toBeUndefined();
  });

  it("beats reference skills by name (no tool list), and every story has nouls", () => {
    for (const s of loadStories()) {
      expect(Object.keys(s.nouls).length).toBeGreaterThan(0);
      for (const b of s.beats) {
        for (const name of b.skills ?? []) {
          expect(typeof name).toBe("string");
        }
        expect(b.template).toBeTruthy();
        expect(b.verify).toBeTruthy();
      }
    }
  });
});
