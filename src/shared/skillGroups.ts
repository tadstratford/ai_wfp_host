// skillGroups — the single source of truth for skill enablement.
//
// One array of groups. Each group maps to concrete app skills and declares
// whether it is always-on (core orchestrator skills) or a user-toggled
// capability. A user's enabled set (admin_users.skills_enabled) stores group
// keys; the skill loader derives the visible skills from the enabled groups
// plus the always-on core. Tools follow skills via each skill's
// "## Tools needed", so enabling a group enables both its skills and tools.

export interface SkillGroupDef {
  key: string;
  label: string;
  description: string;
  skills: string[];
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
    skills: [
      "build",
      "data-handling",
      "guardrails",
      "data-account-check",
      "report-authoring",
      "budgeting",
    ],
    alwaysOn: true,
  },
  {
    key: "workflow-building",
    label: "Workflow & tools",
    description:
      "Detect workflow/tool-building requests and direct to Make Workflow / Modify Workflow.",
    skills: ["workflow-build"],
    alwaysOn: true,
  },
  {
    key: "qbo",
    label: "QuickBooks Online",
    description: "Live QuickBooks Online report analysis, audit, and journaling.",
    skills: ["qbo-analysis", "qbo-audit", "qbo-journaling"],
  },
  {
    key: "email-outbound",
    label: "Outbound Email",
    description:
      "Send outbound email, subject to the workspace outbound allowlist.",
    skills: ["email-outbound"],
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

/** Always-available (core) skill names. */
export const CORE_SKILLS: ReadonlySet<string> = new Set(
  SKILL_GROUPS.filter((g) => g.alwaysOn).flatMap((g) => g.skills),
);

/** Flatten a group-key list to the concrete skill names those groups enable. */
export function skillNamesForGroups(groupKeys: string[]): string[] {
  const set = new Set(groupKeys);
  const names: string[] = [];
  for (const g of SKILL_GROUPS) {
    if (set.has(g.key)) names.push(...g.skills);
  }
  return names;
}

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
