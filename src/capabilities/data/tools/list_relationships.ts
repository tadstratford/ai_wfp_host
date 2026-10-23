import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, buildMasker } from "../scope";
import { buildDataCatalog, collectTables, coverageScan } from "@data/catalog";

export default defineTool({
  name: "list_relationships",
  description:
    "Lists the data catalog's discovered relationships: which key column in one table links to which text column in another (equals or contains), with coverage/confidence and sample evidence. Also lists catalog tables and resolved aliases. Use this to find links before calling reconcile_relationship.",
  class: "read",
  output: { metaType: "json_object", tabular: false },
  inputSchema: {},
  handler: async () => {
    const ws = requireWs();
    // Refresh the catalog on demand so the model always sees relationships for
    // the currently-loaded data (regardless of when/how it was loaded).
    const catalog = buildDataCatalog(ws);
    if (!catalog) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ tables: [], relationships: [], aliases: [] }, null, 2) }] };
    }
    const masker = buildMasker();
    const out: Record<string, unknown> = {
      builtAt: catalog.builtAt,
      tables: catalog.tables,
      relationships: catalog.relationships.map((r) => ({
        id: r.id,
        kind: r.kind,
        left: r.left,
        right: r.right,
        confidence: r.confidence,
        coverage: r.coverage,
        source: r.source,
        evidence: r.evidence.map((e) => ({ left: masker.mask(e.left), right: masker.mask(e.right) })),
      })),
      aliases: catalog.aliases.map((a) => ({
        canonical: masker.mask(a.canonical),
        aliases: a.aliases.map((x) => masker.mask(x)),
      })),
    };
    if (catalog.relationships.length === 0) {
      out.diagnostic = coverageScan(collectTables(ws)).map((s) => ({
        left: s.left,
        right: s.right,
        equals: s.equals,
        contains: s.contains,
      }));
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }] };
  },
});
