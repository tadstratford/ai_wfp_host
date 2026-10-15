// navItems — per-user navigation visibility taxonomy.
//
// The user toggles which shell nav sections are visible on the User page
// (Workflows). Core sections (Chat, Privacy Map, Rules, Data) are always
// visible. This only gates what the shell nav renders — the underlying routes
// stay registered, so direct URLs and deep links keep working when an item is
// hidden.

export interface NavToggleDef {
  key: string;
  label: string;
  description: string;
}

/** The nav sections the user can toggle, with their labels. */
export const NAV_TOGGLE_ITEMS: NavToggleDef[] = [
  {
    key: "overview",
    label: "Workflows",
    description: "The workflow board and overview.",
  },
];

export const NAV_TOGGLE_KEYS = NAV_TOGGLE_ITEMS.map((g) => g.key);

/** Visible by default — empty means every toggleable section starts hidden. */
export const DEFAULT_VISIBLE_NAV_KEYS: string[] = [];

/** Whether a toggleable nav section is currently visible for the user.
 *  Toggleable sections start hidden (DEFAULT_VISIBLE_NAV_KEYS is empty) — a
 *  section is visible only when it's explicitly listed in `navVisible`. */
export function isNavVisible(navVisible: string[] | null | undefined, key: string): boolean {
  return Array.isArray(navVisible) && navVisible.includes(key);
}

/** Keep only known toggle keys, in canonical order, ensuring no duplicates. */
export function normalizeNavKeys(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set(NAV_TOGGLE_KEYS);
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
