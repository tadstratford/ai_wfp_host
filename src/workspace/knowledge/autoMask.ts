// Automatic privacy mask — discovers sensitive *values* in a data file (not
// column headers) and appends them to the automated privacy map (real→fake).
//
// Discovery is deterministic and offline (regex for structured PII + compromise
// NER for proper names), so it runs on upload *before* any LLM sees the data.
// Classification lives in fakeGen.ts; storage in privacy.ts. Fakes are realistic
// stand-ins (a name stays a name, a phone stays a phone) so the LLM can still
// reason over masked data.

import nlp from "compromise";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { parseCsv } from "@shared/wfp-api/csv";
import { scanDataRows } from "@data/stage";
import { mergeAutoValues } from "./privacy";
import { detectValueType } from "./fakeGen";

export { detectValueType } from "./fakeGen";

/** Values per NER batch (bounds memory/cost on large files). */
const NER_CHUNK_SIZE = 500;

/** Balanced gate for NER person hits (title-case, bounded, not a date/number). */
function isEntityName(v: string): boolean {
  if (v.length < 2 || v.length > 40) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v)) return false;
  if (/^\d/.test(v)) return false;
  if (!/^[A-Z]/.test(v)) return false;
  return true;
}

/** Streaming, chunked discovery of sensitive values from raw cell values. */
class EntityDiscoverer {
  private entities = new Set<string>();
  private chunk: string[] = [];

  add(value: string): void {
    const v = value.trim();
    if (!v) return;
    if (detectValueType(v)) {
      this.entities.add(v);
      return;
    }
    this.chunk.push(v);
    if (this.chunk.length >= NER_CHUNK_SIZE) this.flush();
  }

  private flush(): void {
    if (this.chunk.length === 0) return;
    const text = this.chunk.join("\n");
    this.chunk = [];
    try {
      const people = nlp(text).people().out("array") as string[];
      for (const p of people) {
        const v = (p ?? "").trim();
        if (isEntityName(v)) this.entities.add(v);
      }
    } catch {
      /* NER is best-effort */
    }
  }

  finish(): Set<string> {
    this.flush();
    return this.entities;
  }
}

// ── Mask application (generic, map-driven) ───────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Mask a single cell value (trimmed exact match; returns the replacement or the value). */
export function maskValue(value: string, forward: Map<string, string>): string {
  if (!value) return value;
  return forward.get(value.trim()) ?? value;
}

/** Best-effort whole-text masking: replace every known value (longest first). */
export function maskText(text: string, forward: Map<string, string>): string {
  if (!text || forward.size === 0) return text;
  let out = text;
  const sorted = Array.from(forward.entries()).sort((a, b) => b[0].length - a[0].length);
  for (const [value, replacement] of sorted) {
    if (out.includes(value)) out = out.split(value).join(replacement);
  }
  return out;
}

export interface TextMasker {
  mask(text: string): string;
}

/**
 * Build a single-pass substring masker from a forward map. Alternation is
 * ordered longest-first so longer entities are matched before shorter ones
 * (e.g. "Meridian Europe GmbH" before "Meridian"). Applied to each cell, it
 * masks entities *within* free text while leaving the rest readable.
 */
export function buildTextMasker(forward: Map<string, string>): TextMasker {
  if (forward.size === 0) return { mask: (t) => t };
  const sorted = Array.from(forward.entries()).sort((a, b) => b[0].length - a[0].length);
  const regex = new RegExp(sorted.map(([v]) => escapeRegExp(v)).join("|"), "g");
  const map = new Map(sorted);
  return { mask: (t) => t.replace(regex, (m) => map.get(m) ?? m) };
}

/**
 * Replace angle tokens in arbitrary text using a reverse map. Kept for legacy
 * support and tests; new masking uses realistic stand-ins instead of tokens.
 */
export function unmaskTokens(text: string, reverse: Map<string, string>): string {
  if (!text || reverse.size === 0) return text;
  return text.replace(/<[a-z0-9_]+>/g, (tok) => reverse.get(tok) ?? tok);
}

function deepUnmask(obj: unknown, reverse: Map<string, string>): unknown {
  if (typeof obj === "string") return unmaskTokens(obj, reverse);
  if (Array.isArray(obj)) return obj.map((v) => deepUnmask(v, reverse));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = deepUnmask(v, reverse);
    }
    return out;
  }
  return obj;
}

/** Reverse angle tokens in an LLM response (text + tool calls). */
export function unmaskAutoResult(result: any, reverse: Map<string, string>): any {
  if (reverse.size === 0) return result;
  const out = { ...result };
  if (typeof out.text === "string") out.text = unmaskTokens(out.text, reverse);
  if (out.toolCall) out.toolCall = deepUnmask(out.toolCall, reverse);
  return out;
}

// ── Discovery + merge ────────────────────────────────────────────────────────

/**
 * Discover sensitive values across a data entry (all content types) and merge
 * them into the automated privacy map (append-only, deduped). Existing values
 * keep their fake; new values are appended.
 */
export function buildAutoMask(databaseId: string, dataName: string): { added: number } {
  const session = getSessionByDatabaseId(databaseId);
  if (!session) return { added: 0 };
  const entry = session.getDataEntry(dataName);
  if (!entry) return { added: 0 };
  const content = typeof entry.content === "string" ? entry.content : "";

  const discoverer = new EntityDiscoverer();

  if (entry.content_type === "json_cells") {
    const cells =
      entry.content_json && typeof entry.content_json === "object" && !Array.isArray(entry.content_json)
        ? (entry.content_json as Record<string, unknown>)
        : {};
    for (const v of Object.values(cells)) {
      if (typeof v === "string") discoverer.add(v);
    }
  } else if (entry.large && entry.header_row != null && content) {
    scanDataRows(
      content,
      { headerIndex: entry.header_row, keyColumns: entry.key_columns ?? [] },
      (cells) => {
        for (const c of cells) discoverer.add(c ?? "");
      },
    );
  } else if (Array.isArray(entry.content_json)) {
    for (const o of entry.content_json as Record<string, unknown>[]) {
      if (o && typeof o === "object") {
        for (const v of Object.values(o)) {
          if (typeof v === "string") discoverer.add(v);
        }
      }
    }
  } else if (content) {
    for (const o of parseCsv(content)) {
      for (const v of Object.values(o)) {
        if (typeof v === "string") discoverer.add(v);
      }
    }
  }

  return mergeAutoValues(databaseId, Array.from(discoverer.finish()));
}

/** Discover sensitive values from an arbitrary list of cell values (e.g. the
 *  columns of a json_cells data entry) and merge into the automated mask. */
export function buildAutoMaskFromValues(
  databaseId: string,
  values: string[],
): { added: number } {
  const discoverer = new EntityDiscoverer();
  for (const v of values) discoverer.add(v ?? "");
  return mergeAutoValues(databaseId, Array.from(discoverer.finish()));
}

// ── Inline discovery (LLM call boundary) ─────────────────────────────────────
//
// Runs right before an LLM API call to catch sensitive values that appeared in
// the request *after* data-load discovery (e.g. QBO / external-MCP tool results).
// Structured-PII regexes + JSON entity-name keys only — no NER — so it stays
// cheap and avoids masking ordinary prose ("Please Review the Accounts").

const EMAIL_SCAN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const SSN_SCAN = /\b\d{3}-\d{2}-\d{4}\b/g;
const EIN_SCAN = /\b\d{2}-\d{7}\b/g;
const IBAN_SCAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const ORG_SPAN_SCAN =
  /[A-Z][A-Za-z0-9&'.\-]+(?:\s+[A-Z][A-Za-z0-9&'.\-]+)*?\s+(?:LLC|L\.?L\.?C\.?|LLP|Ltd\.?|Inc\.?|Corp\.?|GmbH|AG|PLC|S\.?A\.?|Co\.?|LP|BV|Pty)\b/g;

const ENTITY_NAME_KEY_RE = /^(displayname|companyname)$/i;
const ENTITY_REF_PARENT_RE =
  /^(vendor|customer|employee|entity|contact|client|partner|supplier|payee)(ref)?$/i;
const NON_PII_PARENT_RE =
  /^(account|class|department|location|item|category|product|service|project)(ref)?$/i;

function isNameCandidate(v: string): boolean {
  const t = v.trim();
  if (t.length < 2 || t.length > 60) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) return false;
  if (/^\d/.test(t)) return false;
  if (!/^[A-Z]/.test(t)) return false;
  return true;
}

/** Collect string leaves under entity-name keys in a JSON payload. Skips
 *  account/class/location/etc. refs so operational names are never masked. */
function collectJsonNameCandidates(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const out: string[] = [];
  const walk = (node: unknown, parentKey: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, parentKey);
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (typeof v === "string") {
          const isNameKey = ENTITY_NAME_KEY_RE.test(k);
          const isEntityRefName =
            k.toLowerCase() === "name" && ENTITY_REF_PARENT_RE.test(parentKey);
          if (
            (isNameKey || isEntityRefName) &&
            !NON_PII_PARENT_RE.test(parentKey) &&
            isNameCandidate(v)
          ) {
            out.push(v);
          }
        } else {
          walk(v, k);
        }
      }
    }
  };
  walk(parsed, "");
  return out;
}

/** True when the request contains at least one tool result (the only source of
 *  newly-introduced external data — gates inline discovery to avoid scanning
 *  pure chat turns). */
export function hasToolResultBlocks(request: {
  messages?: Array<{ content?: string | Array<{ type?: string }> }>;
}): boolean {
  return (request.messages ?? []).some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((b) => b && b.type === "tool_result"),
  );
}

/** Discover sensitive values in an outgoing LLM request and append them to the
 *  automated privacy map (append-only, deduped). Returns the number added. */
export function discoverRequestValues(
  databaseId: string,
  request: { system?: string; messages?: any[] },
): { added: number } {
  if (!getSessionByDatabaseId(databaseId)) return { added: 0 };
  return mergeAutoValues(databaseId, collectRequestCandidates(request));
}

/** Pure candidate collection (testable without a workspace session): extract
 *  structured-PII spans and JSON entity-name leaves from an LLM request. */
export function collectRequestCandidates(request: {
  system?: string;
  messages?: any[];
}): string[] {
  const candidates = new Set<string>();
  const add = (v: unknown) => {
    const t = String(v ?? "").trim();
    if (t) candidates.add(t);
  };

  const scanText = (text: string) => {
    for (const re of [EMAIL_SCAN, SSN_SCAN, EIN_SCAN, IBAN_SCAN, ORG_SPAN_SCAN]) {
      for (const m of text.match(re) ?? []) add(m);
    }
  };

  const scanContent = (text: string) => {
    for (const n of collectJsonNameCandidates(text)) add(n);
    scanText(text);
  };

  if (typeof request.system === "string") scanText(request.system);
  for (const msg of request.messages ?? []) {
    if (typeof msg.content === "string") scanContent(msg.content);
    else if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (!b) continue;
        if (b.type === "text" && typeof b.text === "string") scanText(b.text);
        else if (b.type === "tool_result" && typeof b.content === "string") scanContent(b.content);
      }
    }
  }

  return Array.from(candidates);
}
