import { describe, it, expect } from "bun:test";
import { parseRule } from "./ruleParse";

const rule = `## Instructions
1. Shared services are allocated every month, in full, to the three funds using the percentages in the allocation table (\`allocation_table_allocation\`).
2. Compute the split with \`qbodemo_allocation_compute\`.
3. Preview the computed lines and confirm with the user, then post with \`qbodemo_journal_create\`:
    - Debit the \`Shared Services\` expense account for each fund's share, with \`class\` set to that fund.
    - Credit the \`Shared Services Clearing\` account for the full month total (no class).
4. The debits must equal the credit. Preview the entry and confirm with the user before posting.

## Tools needed
- \`qbodemo_allocation_compute\` — computes the split.
- \`qbodemo_journal_create\` — posts the journal entry.

## Rules
- Percentages must come from the allocation table — never guess.
- Debits always equal credits within $0.01.
`;

describe("parseRule", () => {
  it("groups sub-bullets under their parent numbered step", () => {
    const parsed = parseRule(rule);
    expect(parsed.instructions).toHaveLength(4);
    expect(parsed.instructions[2]).toContain("post with `qbodemo_journal_create`");
    expect(parsed.instructions[2]).toContain("Debit the `Shared Services` expense account");
    expect(parsed.instructions[2]).toContain("Credit the `Shared Services Clearing` account");
  });

  it("takes tools from the structured field (not from content)", () => {
    const parsed = parseRule(rule, [
      { name: "qbodemo_allocation_compute", role: "compute the split" },
      { name: "qbodemo_journal_create", role: "post the entry" },
    ]);
    expect(parsed.tools).toEqual(["qbodemo_allocation_compute", "qbodemo_journal_create"]);
    expect(parsed.rules.length).toBe(2);
  });

  it("yields no tools when the structured field is absent", () => {
    expect(parseRule(rule).tools).toEqual([]);
  });
});
