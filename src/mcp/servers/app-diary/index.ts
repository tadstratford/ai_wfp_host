import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { ensureDiaryHighlights } from "@backend/core/workspace/diary/summarize";

/**
 * app-diary — read-only query surface over the workspace diary (the compact,
 * timestamped "story of what happened, and by whom").
 *
 * Three read tools across the diary's three tiers: narrative (whole-file),
 * summaries (mid-tier), and search (a term across all tiers). Reading
 * opportunistically fills LLM highlights (best-effort, one per call) so the
 * story reads naturally without blocking the capture path.
 */

let ctx: { databaseId: string } = { databaseId: "" };

export function setDiaryContext(c: { databaseId: string }) {
  ctx = c;
}

function requireWs() {
  if (!ctx.databaseId) throw new Error("No active workspace for diary.");
  const session = getSessionByDatabaseId(ctx.databaseId);
  if (!session) throw new Error("No workspace session open.");
  return session;
}

export async function initDiaryServer(transport: Transport) {
  const server = new McpServer({ name: "diary", version: "1.0.0" });

  server.tool(
    "diary_narrative",
    "The whole-file diary: a condensed, timestamped narrative of what has happened in this workspace (most recent first).",
    {},
    async () => {
      const session = requireWs();
      await ensureDiaryHighlights(ctx.databaseId);
      const diary = session.getDiary();
      return { content: [{ type: "text", text: JSON.stringify(diary.narrative) }] };
    },
  );

  server.tool(
    "diary_summaries",
    "Mid-tier diary summaries: each condenses a batch of activity entries into actors, entities, and highlights.",
    {},
    async () => {
      const session = requireWs();
      await ensureDiaryHighlights(ctx.databaseId);
      const diary = session.getDiary();
      return { content: [{ type: "text", text: JSON.stringify(diary.summaries) }] };
    },
  );

  server.tool(
    "diary_search",
    "Search the activity diary (entries, summaries, narrative) for a term — e.g. an entity, actor, or topic. Returns matching items with timestamps.",
    { query: z.string().describe("Search term (name, entity, actor, or topic).") },
    async ({ query }) => {
      const session = requireWs();
      const diary = session.getDiary();
      const q = query.toLowerCase();
      const results: unknown[] = [];
      for (const e of diary.entries) {
        if (JSON.stringify([e.summary, e.entities, e.tags, e.actor]).toLowerCase().includes(q)) {
          results.push({ tier: "entry", eventAt: e.eventAt, actor: e.actor, summary: e.summary });
        }
      }
      for (const s of diary.summaries) {
        if (JSON.stringify([s.byActor, s.byEntity, s.highlights, s.sample]).toLowerCase().includes(q)) {
          results.push({ tier: "summary", from: s.from, to: s.to, count: s.count, highlights: s.highlights });
        }
      }
      for (const n of diary.narrative) {
        if (JSON.stringify(n.highlights).toLowerCase().includes(q)) {
          results.push({ tier: "narrative", from: n.from, to: n.to, highlights: n.highlights });
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(results.slice(0, 50)) }] };
    },
  );

  await server.connect(transport);
}
