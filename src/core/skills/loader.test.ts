import { describe, it, expect } from "bun:test";
import { loadAppSkills, declaredTools, enabledSkillNamesForDatabase } from "./loader";

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

  it("derives each skill's group from frontmatter (single source of truth)", () => {
    const skills = loadAppSkills();
    expect(skills.find((s) => s.name === "report-authoring")?.group).toBe("core");
    expect(skills.find((s) => s.name === "qbodemo-journaling")?.group).toBe("qbodemo");
    expect(skills.find((s) => s.name === "budgeting")?.group).toBe("budgeting");
    expect(skills.find((s) => s.name === "email-outbound")?.group).toBe("email-outbound");
  });

  it("filters skills by enabled group (defaults = always-on only)", () => {
    const enabled = enabledSkillNamesForDatabase("unmapped-db");
    expect(enabled.has("report-authoring")).toBe(true);
    expect(enabled.has("data-account-check")).toBe(true);
    expect(enabled.has("qbo-analysis")).toBe(false);
    expect(enabled.has("qbodemo-budgeting")).toBe(false);
    expect(enabled.has("email-outbound")).toBe(false);
  });
});
