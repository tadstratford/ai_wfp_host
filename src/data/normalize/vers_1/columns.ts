// Pass 1 — column-role mapping (deterministic alias lookup). A Jev `choice`
// fallback for unknown headers can be layered on top (Phase 2).

import { normalizeHeader } from "@data/qbo/helpers";
import type { ColumnRole, NormalizeConfig } from "./types";

export interface ColumnRoleMap {
  /** column index → role */
  roles: ColumnRole[];
  /** role → first column index */
  byRole: Partial<Record<ColumnRole, number>>;
}

export function mapColumnRoles(
  headerRow: string[],
  config: NormalizeConfig,
): ColumnRoleMap {
  const roles: ColumnRole[] = (headerRow ?? []).map((h) => {
    const norm = normalizeHeader(h);
    for (const role of config.columnRoles) {
      const aliases = config.columnAliases[role] ?? [];
      if (aliases.includes(norm)) return role;
    }
    return "ignore";
  });

  const byRole: Partial<Record<ColumnRole, number>> = {};
  roles.forEach((r, i) => {
    if (r !== "ignore" && byRole[r] === undefined) byRole[r] = i;
  });

  return { roles, byRole };
}
