/**
 * Glass Box Narrator — the ONLY place an LLM touches the Overview band.
 *
 * Two products, both governed by docs/GEN_UI_RULES.md:
 *
 *  A. toneLine()         — one warm sentence over the deterministic band. The
 *                          model writes a single string; everything structural
 *                          (counts, verdict, the Next CTA) stays deterministic.
 *
 *  B. generativeBlocks() — the "fully generative" variant. The model COMPOSES a
 *                          layout by choosing from a fixed block vocabulary; it
 *                          never emits markup, never invents numbers (verdict
 *                          counts are overridden with the real ones), and never
 *                          invents links (actions are an allowlist). See
 *                          validateBlocks().
 *
 * Both fail closed: any LLM error or malformed output falls back to a
 * deterministic template, so the Overview never hangs or shows a broken card
 * (feedback_no_fallbacks_no_nlp — fail with a sane default, never silently wrong).
 *
 * Output is cached per workspace, keyed by stateHash, and evicted on session
 * close via WorkspaceSession.onClose (CONVENTIONS.md D6/D7: workspace-keyed
 * caches must tear down with the session).
 */

import { llmCall } from "@backend/core/models/llmCall";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { type WorkspaceState, stateHash } from "./workspaceState";

// ── The whitelisted block vocabulary (the generative contract) ───────────────
export type GenBlock =
  | { type: "headline"; text: string }
  | { type: "stat"; label: string; value: string; tone: "neutral" | "good" | "warn" }
  | { type: "verdict"; verified: number; failed: number }
  | { type: "note"; text: string }
  | { type: "action"; actionId: string };

// ── Per-workspace cache (evicted on session close) ───────────────────────────
interface CacheEntry {
  hash: string;
  tone?: string;
  blocks?: GenBlock[];
}
const cache = new Map<string, CacheEntry>();
const teardownRegistered = new Set<string>();

function registerTeardown(databaseId: string): void {
  if (teardownRegistered.has(databaseId)) return;
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return;
  teardownRegistered.add(databaseId);
  ws.onClose(() => {
    cache.delete(databaseId);
    teardownRegistered.delete(databaseId);
  });
}

function entryFor(databaseId: string, hash: string): CacheEntry {
  let e = cache.get(databaseId);
  if (!e || e.hash !== hash) {
    e = { hash };
    cache.set(databaseId, e);
  }
  registerTeardown(databaseId);
  return e;
}

/** The compact, id-free view of state the model is allowed to see. */
function summaryForLLM(s: WorkspaceState) {
  return {
    workspace: s.workspaceName,
    chats: { total: s.sessions.total, waitingOnYou: s.sessions.awaitingYou, running: s.sessions.inProgress, completed: s.sessions.completed },
    plans: s.plans,
    openTodoLists: s.todoLists.open,
    trust: s.trust,
    flaggedForReview: s.topException?.subject ?? null,
    nextMove: { kind: s.next.kind, label: s.next.label, why: s.next.reason },
  };
}

// ── A. Tone line ─────────────────────────────────────────────────────────────

const TONE_SYSTEM =
  `You write ONE short, warm sentence for the top of a finance/accounting workspace ` +
  `dashboard. It reflects the user's current state back to them so the app feels like ` +
  `it is working alongside them. Be calm and specific; never alarming, never salesy, ` +
  `never use a number you were not given. No emojis. No markdown. Return ONLY the ` +
  `sentence, nothing else. Max 18 words.`;

/** Deterministic fallback sentence — also the shape the LLM is imitating. */
export function templateTone(s: WorkspaceState): string {
  if (s.sessions.awaitingYou > 0) {
    return `One chat is waiting on you — everything else is on track.`;
  }
  if (s.trust.failed > 0) {
    const n = s.trust.failed;
    return `You're almost clear — ${n} item${n > 1 ? "s" : ""} need${n > 1 ? "" : "s"} a quick review.`;
  }
  if (s.plans.open > 0) {
    const n = s.plans.open;
    return `${n} planned step${n > 1 ? "s" : ""} left — nice momentum.`;
  }
  return `Your workspace is clear. Ready when you are.`;
}

export async function toneLine(databaseId: string, state: WorkspaceState): Promise<string> {
  const e = entryFor(databaseId, stateHash(state));
  if (e.tone !== undefined) return e.tone;

  let line = templateTone(state);
  try {
    const res = await llmCall(databaseId, "overview:glassbox-tone", {
      systemPrompt: TONE_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(summaryForLLM(state)) }],
      temperature: 0.4,
      maxTokens: 80,
    });
    const t = res.text.trim().replace(/^["']|["']$/g, "").split("\n")[0].trim();
    if (t) line = t.slice(0, 200);
  } catch {
    /* keep the deterministic template */
  }
  e.tone = line;
  return line;
}

// ── B. Generative blocks ─────────────────────────────────────────────────────

const GENUI_SYSTEM =
  `You compose a small dashboard card that reflects a finance workspace's state back ` +
  `to its user, so the app feels alive and attentive. You DO NOT write HTML — you ` +
  `return a JSON array of blocks, and the app renders them.\n\n` +
  `Allowed block types (use 3 to 6 blocks, ordered for a human reader):\n` +
  `- {"type":"headline","text":string}  — one warm orienting sentence.\n` +
  `- {"type":"stat","label":string,"value":string,"tone":"neutral"|"good"|"warn"} — one figure.\n` +
  `- {"type":"verdict","verified":number,"failed":number} — the trust tally (use the numbers given).\n` +
  `- {"type":"note","text":string} — one short reflective line.\n` +
  `- {"type":"action","actionId":string} — a button; actionId MUST be one of allowedActions.\n\n` +
  `Rules: Never invent a number — only use values from the provided state. Never use an ` +
  `actionId outside allowedActions. Include exactly one "action" block referencing the ` +
  `next move when allowedActions is non-empty. No emojis, no markdown. ` +
  `Respond with STRICT JSON only: {"blocks":[ ... ]}.`;

/** Deterministic fallback layout when the model is unavailable or invalid. */
export function fallbackBlocks(state: WorkspaceState, allowedActionIds: string[]): GenBlock[] {
  const blocks: GenBlock[] = [
    { type: "headline", text: templateTone(state) },
    { type: "stat", label: "Chats waiting on you", value: String(state.sessions.awaitingYou), tone: state.sessions.awaitingYou > 0 ? "warn" : "good" },
    { type: "verdict", verified: state.trust.verified, failed: state.trust.failed },
  ];
  if (allowedActionIds.includes("next")) blocks.push({ type: "action", actionId: "next" });
  return blocks;
}

/**
 * Coerce the model's output to the whitelist: drop unknown block types and
 * malformed entries, override verdict counts with the REAL ones (the model may
 * never decide a verdict), and drop actions whose id isn't allowlisted. Text is
 * left as-is; the renderer escapes it (JSX), so injected markup is inert.
 */
export function validateBlocks(
  raw: unknown,
  allowedActionIds: string[],
  state: WorkspaceState,
): GenBlock[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: GenBlock[] = [];
  for (const b of arr) {
    if (!b || typeof b !== "object") continue;
    const t = (b as { type?: unknown }).type;
    if (t === "headline" && typeof (b as any).text === "string") {
      out.push({ type: "headline", text: (b as any).text.slice(0, 240) });
    } else if (t === "note" && typeof (b as any).text === "string") {
      out.push({ type: "note", text: (b as any).text.slice(0, 280) });
    } else if (t === "stat" && typeof (b as any).label === "string" && (b as any).value != null) {
      const tone = (b as any).tone;
      out.push({
        type: "stat",
        label: String((b as any).label).slice(0, 60),
        value: String((b as any).value).slice(0, 40),
        tone: tone === "good" || tone === "warn" ? tone : "neutral",
      });
    } else if (t === "verdict") {
      // Numbers are NOT trusted from the model — always the recorded tally.
      out.push({ type: "verdict", verified: state.trust.verified, failed: state.trust.failed });
    } else if (t === "action" && typeof (b as any).actionId === "string") {
      if (allowedActionIds.includes((b as any).actionId)) {
        out.push({ type: "action", actionId: (b as any).actionId });
      }
    }
  }
  return out.slice(0, 8);
}

export async function generativeBlocks(
  databaseId: string,
  state: WorkspaceState,
  allowedActionIds: string[],
): Promise<GenBlock[]> {
  const e = entryFor(databaseId, stateHash(state));
  if (e.blocks !== undefined) return e.blocks;

  let blocks = fallbackBlocks(state, allowedActionIds);
  try {
    const res = await llmCall(databaseId, "overview:glassbox-genui", {
      systemPrompt: GENUI_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({ state: summaryForLLM(state), allowedActions: allowedActionIds }),
        },
      ],
      temperature: 0.5,
      maxTokens: 700,
      responseFormat: "json",
    });
    const raw = Array.isArray(res.data) ? res.data : res.data?.blocks;
    const valid = validateBlocks(raw, allowedActionIds, state);
    if (valid.length) blocks = valid;
  } catch {
    /* keep the deterministic fallback layout */
  }
  e.blocks = blocks;
  return blocks;
}
