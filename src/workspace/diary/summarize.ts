// Diary LLM summarization — session descriptions and highlight generation.
//
// `callProvider` applies the workspace privacy mask automatically, so names in
// the diary text are replaced with stand-ins before they reach the model.
// Every call is best-effort: on failure (or no key) it returns a fallback and
// never throws.

import { callProvider } from "@backend/core/llm/providers";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { DiarySummary } from "wfp-format";

const DIARY_SYSTEM =
  "You write concise work-diary entries for an accounting workspace. Summarize the activity in plain language, mentioning what was done and by whom. Keep it short and factual; do not invent events, names, or amounts.";

/** 1–2 sentence description of a completed session. Falls back to `name`. */
export async function describeSession(
  databaseId: string,
  name: string,
  sample: string,
): Promise<string> {
  try {
    const result = await callProvider(
      databaseId,
      {
        system: DIARY_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Session: ${name}\n\n${sample || "(no transcript available)"}\n\nWrite a 1–2 sentence summary of what this session accomplished.`,
          },
        ],
        maxTokens: 160,
      },
      { mode: "diary" },
    );
    const text = (result.text || "").trim();
    return text || name;
  } catch (err) {
    console.error("[diary] describeSession failed:", err);
    return name;
  }
}

/** 2–4 short highlights for a batch of activity. Returns [] on failure. */
export async function generateHighlights(
  databaseId: string,
  text: string,
): Promise<string[]> {
  try {
    const result = await callProvider(
      databaseId,
      {
        system: DIARY_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Activity log:\n${text}\n\nWrite 2–4 short highlights summarizing what happened and by whom. One highlight per line.`,
          },
        ],
        maxTokens: 300,
      },
      { mode: "diary" },
    );
    return (result.text || "")
      .split("\n")
      .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, 4);
  } catch (err) {
    console.error("[diary] generateHighlights failed:", err);
    return [];
  }
}

function summaryToText(s: DiarySummary): string {
  const actor = Object.entries(s.byActor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} (${v})`)
    .join(", ");
  const entity = Object.entries(s.byEntity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k} (${v})`)
    .join(", ");
  const total = s.totals?.amount !== undefined ? `total amount ${s.totals.amount}` : "";
  return [
    `${s.count} entries from ${s.from} to ${s.to}.`,
    actor ? `Actors: ${actor}.` : "",
    entity ? `Entities: ${entity}.` : "",
    total,
    s.sample.length ? `Recent: ${s.sample.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Lazily fill the LLM highlights for ONE empty summary (or narrative chunk),
 *  so diary reads surface generated narrative without blocking. Returns true
 *  when something was filled. Call repeatedly to drain all empties. */
export async function ensureDiaryHighlights(databaseId: string): Promise<boolean> {
  const session = getSessionByDatabaseId(databaseId);
  if (!session) return false;
  const diary = session.getDiary();

  for (const s of diary.summaries) {
    if (s.highlights.length > 0) continue;
    const hl = await generateHighlights(databaseId, summaryToText(s));
    if (hl.length) {
      session.setDiarySummaryHighlights(s.id, hl);
      return true;
    }
    break;
  }
  for (const n of diary.narrative) {
    if (n.highlights.length > 0) continue;
    const hl = await generateHighlights(databaseId, `Period ${n.from} → ${n.to}: ${n.count} summaries.`);
    if (hl.length) {
      session.setDiaryNarrativeHighlights(n.id, hl);
      return true;
    }
    break;
  }
  return false;
}
