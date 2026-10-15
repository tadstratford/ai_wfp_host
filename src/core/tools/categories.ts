/**
 * Category Map — single source of truth for tool categories.
 *
 * Key  : the string used in tool definitions (category: "flow")
 * catName : display label shown in the UI
 * order   : sort order in the left panel (lower = higher)
 * color   : hex color used for dots in the left panel AND node fills in the graph
 *
 * If a tool's category key is not found here it falls to "other" automatically.
 * To add a new category: add one entry here, then use the key in tool definitions.
 */
export interface CatEntry {
  catName: string;
  order: number;
  color: string; // hex only — works in SVG fill and HTML inline style
}

export const catMap: Record<string, CatEntry> = {
  custom_tool: { catName: "Custom Tools", order: 1, color: "#6366f1" }, // indigo-500
  flow: { catName: "Flow Control", order: 2, color: "#f97316" }, // orange-500
  acctg: { catName: "Accounting", order: 3, color: "#10b981" }, // emerald-500
  file: { catName: "Inputs and Outputs", order: 4, color: "#3b82f6" }, // blue-500
  integrations: { catName: "Integrations", order: 5, color: "#0ea5e9" }, // sky-500
  emails: { catName: "Emails", order: 6, color: "#f59e0b" }, // amber-500
  ai: { catName: "AI & Automation", order: 7, color: "#8b5cf6" }, // violet-500
  other: { catName: "Other", order: 8, color: "#22c55e" }, // green-500
};

/**
 * Returns the catMap entry for the given key.
 * Falls back to the "other" entry if the key is unknown.
 */
export function getCatEntry(categoryKey: string): CatEntry {
  return catMap[categoryKey] ?? catMap["other"];
}

/**
 * Resolves a tool's raw category string to a valid catMap key.
 * Returns "other" for any key not present in the map.
 */
export function resolveCatKey(categoryKey: string | undefined): string {
  if (categoryKey && catMap[categoryKey]) return categoryKey;
  return "other";
}
