import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, toRows, buildMasker } from "../scope";
import { reconcileRelationship } from "@data/reconcileRelationship";
import { buildDataCatalog } from "@data/catalog";

export default defineTool({
  name: "reconcile_relationship",
  description:
    "Reconciles two tabular data files on a discovered relationship where the join key is embedded in a text column (e.g. a schedule keyed on 'Deal Name' against an ICO 'Description' containing 'Write off - <Deal>: …'). Deterministic — no LLM. Reports per-key variances and orphan keys on each side. Use list_relationships to discover links, then reconcile_relationship with either relationship_id or explicit on_left/on_right columns.",
  class: "read",
  output: { metaType: "json_object", tabular: true },
  durable: true,
  inputSchema: {
    relationship_id: z.string().optional().describe("Catalog relationship id (from list_relationships). Resolves left/right/on/kind automatically."),
    left: z.string().optional().describe("Left data name (the keyed side, e.g. the schedule)."),
    right: z.string().optional().describe("Right data name (the side whose text column embeds the key)."),
    on_left: z.string().optional().describe("Key column in left (e.g. 'Deal Name')."),
    on_right: z.string().optional().describe("Text column in right (e.g. 'Description')."),
    kind: z.enum(["equals", "contains"]).optional().describe("How the key appears on the right: equal to a cell, or contained within it."),
    compare_left: z.string().optional().describe("Numeric column on the left to compare (e.g. 'Total Expenses')."),
    compare_right: z.string().optional().describe("Numeric column on the right to compare (e.g. 'Amount')."),
    tolerance: z.number().min(0).optional().describe("Numeric tolerance for declaring a match (default 0)."),
  },
  handler: async ({ relationship_id, left, right, on_left, on_right, kind, compare_left, compare_right, tolerance }) => {
    const ws = requireWs();

    let L = left;
    let R = right;
    let onL = on_left;
    let onR = on_right;
    let k = kind ?? "contains";

    const catalog = buildDataCatalog(ws);
    if (relationship_id) {
      const rel = catalog?.relationships.find((r) => r.id === relationship_id);
      if (!rel) {
        return { content: [{ type: "text" as const, text: `Relationship "${relationship_id}" not found in the catalog.` }], isError: true };
      }
      L = rel.left.table;
      R = rel.right.table;
      onL = rel.left.column;
      onR = rel.right.column;
      k = rel.kind;
    }

    if (!L || !R || !onL || !onR || !compare_left || !compare_right) {
      return {
        content: [{
          type: "text" as const,
          text: "Provide either relationship_id, or left/right/on_left/on_right/kind plus compare_left and compare_right.",
        }],
        isError: true,
      };
    }

    const leftEntry = ws.getDataEntry(L);
    if (!leftEntry) return { content: [{ type: "text" as const, text: `Data "${L}" not found.` }], isError: true };
    const rightEntry = ws.getDataEntry(R);
    if (!rightEntry) return { content: [{ type: "text" as const, text: `Data "${R}" not found.` }], isError: true };

    const leftRows = toRows(leftEntry);
    if (leftRows === null) return { content: [{ type: "text" as const, text: `"${L}" is not tabular.` }], isError: true };
    const rightRows = toRows(rightEntry);
    if (rightRows === null) return { content: [{ type: "text" as const, text: `"${R}" is not tabular.` }], isError: true };

    // Flatten catalog aliases → { aliasLower: canonical }.
    const aliases: Record<string, string> = {};
    for (const a of catalog?.aliases ?? []) {
      for (const alias of a.aliases) aliases[alias.toLowerCase()] = a.canonical;
    }

    const result = reconcileRelationship({
      leftRows,
      rightRows,
      leftKey: onL,
      rightKey: onR,
      kind: k,
      leftAmount: compare_left,
      rightAmount: compare_right,
      tolerance,
      aliases,
    });

    const masker = buildMasker();
    const masked = {
      left: L,
      right: R,
      on_left: onL,
      on_right: onR,
      kind: result.kind,
      tolerance: result.tolerance,
      summary: result.summary,
      mismatches: result.mismatches.map((m) => ({ key: masker.mask(m.key), left: m.left, right: m.right, difference: m.difference })),
      missing_right: result.missing_right.map((k) => masker.mask(k)),
      missing_left: result.missing_left.map((k) => masker.mask(k)),
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(masked, null, 2) }] };
  },
});
