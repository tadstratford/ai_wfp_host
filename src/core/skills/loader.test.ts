import { describe, it, expect } from "bun:test";
import { loadAppSkills, declaredTools } from "./loader";

describe("loadAppSkills", () => {
  it("parses structured tools from skill frontmatter", () => {
    const skills = loadAppSkills();
    const j = skills.find((s) => s.name === "qbodemo-journaling");
    expect(j).toBeDefined();
    const names = (j!.tools ?? []).map((t) => t.name);
    expect(names).toContain("qbodemo_allocation_compute");
    expect(names).toContain("qbodemo_journal_create");
    expect(names).toContain("show_message");
  });

  it("keeps the legacy declaredTools extraction for migration", () => {
    const legacy = `## Instructions\n1. Compute with \`qbodemo_allocation_compute\`.\n\n## Tools needed\n- \`qbodemo_allocation_compute\` — computes the split\n- \`qbodemo_journal_create\` — posts\n`;
    expect(declaredTools(legacy)).toEqual(["qbodemo_allocation_compute", "qbodemo_journal_create"]);
  });

  it("loads all app skills without group filtering", () => {
    const skills = loadAppSkills();
    const names = new Set(skills.map((s) => s.name));
    expect(names.has("report-authoring")).toBe(true);
    expect(names.has("data-account-check")).toBe(true);
    expect(names.has("qbo-analysis")).toBe(true);
    expect(names.has("qbodemo-budgeting")).toBe(true);
    expect(names.has("email-outbound")).toBe(true);
  });
});
