// skillGroups — the canonical set of skill-group ids (capabilities).
//
// One list of groups. Each group has a stable `key` (its id) — skills declare
// their group via frontmatter `group:` and a user's enabled set references the
// same keys, so renaming a group's label never breaks a preference. Enablement
// is by group: only skills whose group is always-on or user-enabled participate
// in routing, and tools follow those skills.
//
// NOTE: this module no longer lists group → skills. That mapping is the skill
// frontmatter's job (single source of truth); `loadAppSkills` derives it.

export interface SkillGroupDef {
  key: string;
  label: string;
  description: string;
  /** Always available; not shown as a user toggle. */
  alwaysOn?: boolean;
  /** Enabled by default for new users with no stored preference. */
  defaultEnabled?: boolean;
}

export const SKILL_GROUPS: SkillGroupDef[] = [
  {
    key: "core",
    label: "Core",
    description:
      "Core assistant skills for planning, building, data handling, reporting, and safety.",
    alwaysOn: true,
  },
  {
    key: "workflow-building",
    label: "Workflow & tools",
    description:
      "Detect workflow/tool-building requests and direct to Make Workflow / Modify Workflow.",
    alwaysOn: true,
  },
  {
    key: "qbo",
    label: "QBO",
    description: "Live QuickBooks Online report analysis, audit, and journaling.",
  },
  {
    key: "qbodemo",
    label: "QBO Demo",
    description:
      "Demo-only QuickBooks company (Acme Fund Services) for budget-vs-actual and fund-allocation walkthroughs.",
  },
  {
    key: "email-outbound",
    label: "Email Outbound",
    description:
      "Send outbound email, subject to the workspace outbound allowlist.",
  },
  {
    key: "budgeting",
    label: "Budgeting",
    description:
      "Budget-vs-actual planning, variance reporting, and cash forecasts.",
  },
];

/** Group keys the user can toggle (everything except always-on core). */
export const TOGGLEABLE_SKILL_GROUP_KEYS = SKILL_GROUPS.filter(
  (g) => !g.alwaysOn,
).map((g) => g.key);

export const ALL_SKILL_GROUP_KEYS = SKILL_GROUPS.map((g) => g.key);

/** Groups enabled by default when a user has no stored preference. */
export const DEFAULT_SKILL_GROUP_KEYS = SKILL_GROUPS.filter(
  (g) => g.defaultEnabled && !g.alwaysOn,
).map((g) => g.key);

/** Always-on group keys (core + workflow-building). */
export const ALWAYS_ON_GROUP_KEYS = SKILL_GROUPS.filter(
  (g) => g.alwaysOn,
).map((g) => g.key);

/** Keep only known group keys, in canonical order, ensuring no duplicates. */
export function normalizeGroupKeys(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set(ALL_SKILL_GROUP_KEYS);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of input) {
    if (typeof k === "string" && valid.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}
