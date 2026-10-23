/**
 * Lean workspace context for the Jev (Classifier) surfaces.
 *
 * Unlike `manifest.ts` (a heavy, async, full-workspace manifest for the workflow
 * builder), these helpers expose only the smallest slice the classifier needs to
 * route and gate a request: workspace rules (name + description + tags — never
 * full markdown) and loaded data-file names (never columns). Full rule content
 * is loaded separately by `resolveRule`, `auditChatPlan`, and `prompts.ts`.
 */

import { loadRules } from "../../rules/loader";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

export interface RuleBrief {
  name: string;
  description?: string;
  tags?: string[];
}

/** Workspace-authored rules, reduced to name + description + tags. Rules are
 *  user data (distinct from app skills) and are surfaced to the classifier so
 *  routing and shape classification can be rule-aware. */
export function ruleBriefs(databaseId: string): RuleBrief[] {
  try {
    return loadRules(databaseId).map((r) => ({
      name: r.name,
      description: r.description,
      tags: r.tags,
    }));
  } catch {
    return [];
  }
}

/** A one-line, log-friendly rendering of a rule brief ("name — description [tag]"). */
export function ruleBriefLines(databaseId: string): string[] {
  return ruleBriefs(databaseId).map((r) =>
    [r.name, r.description, r.tags?.length ? `[${r.tags.join(", ")}]` : ""]
      .filter(Boolean)
      .join(" — "),
  );
}

/** Loaded data-file names (names only, so the classifier prompt stays lean). */
export function dataFileNames(databaseId: string): string[] {
  try {
    const ws = getSessionByDatabaseId(databaseId);
    return ws ? ws.getDataNames() : [];
  } catch {
    return [];
  }
}
