/**
 * Deterministic parameter extraction.
 *
 * Given a routed tool's parameter schema and the user's raw text, try to pull
 * each parameter's value out of the text using type-driven rules. Anything that
 * can't be resolved is left "missing" (or filled from its default) so the caller
 * can decide whether to hand the request to the LLM or ask the user.
 */

import type { ToolParam } from "./schema";
import { resolveRange, resolveDate } from "./dates";

export interface ExtractedParam {
  name: string;
  value: unknown;
  source: "extracted" | "default" | "missing" | "clarified";
}

export interface ExtractionResult {
  values: Record<string, unknown>;
  params: ExtractedParam[];
  missingRequired: string[];
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const NUMBER_RE = /-?\$?\s?\d[\d,]*(?:\.\d+)?/;
const BOOL_TRUE = /\b(yes|true|on|enable|enabled)\b/i;
const BOOL_FALSE = /\b(no|false|off|disable|disabled)\b/i;

const ENUM_SYNONYMS: Record<string, string[]> = {
  months: ["monthly", "month by month", "month-by-month", "per month", "each month", "by month"],
  total: ["single column", "one column", "overall", "in total"],
  days: ["daily", "day by day", "per day", "by day"],
  weeks: ["weekly", "week by week", "per week", "by week"],
  annual: ["yearly", "annually", "year over year", "yoy", "per year"],
  quarterly: ["quarter by quarter", "by quarter", "per quarter"],
  accrual: ["accrual basis"],
  cash: ["cash basis"],
  monthly: ["every month"],
};

function looksDate(param: ToolParam): boolean {
  const name = param.name.toLowerCase();
  // Split on non-letters so snake_case/camelCase names ("start_date", "startDate")
  // are detected — a bare `\b` word boundary misses the underscore (a word char).
  if (/asof|as_of/.test(name)) return true;
  const tokens = name.split(/[^a-z]+/).filter(Boolean);
  if (
    tokens.some((t) =>
      ["date", "period", "quarter", "month", "week", "year", "start", "end"].includes(t),
    )
  )
    return true;
  const desc = (param.description ?? "").toLowerCase();
  return /(yyyy-mm-dd|date range|start date|end date|as of|as-of|period)/.test(desc);
}

function looksEmail(param: ToolParam): boolean {
  const name = param.name.toLowerCase();
  if (
    /(^|_)(email|e_mail|emails|address|recipient|sender|reply_to|replyto|to|from|cc|bcc)(_|$)/.test(
      name,
    )
  )
    return true;
  const desc = (param.description ?? "").toLowerCase();
  return /\bemail address\b|\brecipient\b|\bsender\b/.test(desc);
}

function firstNumber(text: string): number | null {
  const m = text.match(NUMBER_RE);
  if (!m) return null;
  const cleaned = m[0].replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function extractBoolean(text: string): boolean | null {
  if (BOOL_TRUE.test(text)) return true;
  if (BOOL_FALSE.test(text)) return false;
  return null;
}

function matchEnum(text: string, values: string[]): string | null {
  const t = text.toLowerCase();
  for (const v of values) {
    const key = v.toLowerCase();
    if (t.includes(key)) return v;
    const syns = ENUM_SYNONYMS[key];
    if (syns && syns.some((s) => t.includes(s))) return v;
  }
  return null;
}

function extractEmail(text: string): string | null {
  const m = text.match(EMAIL_RE);
  return m ? m[0] : null;
}

/** Pull a quoted phrase, a "called/named/titled X" phrase, or fall back. */
function extractString(param: ToolParam, text: string): string | null {
  const name = param.name.toLowerCase();
  const wholeMessage = /(body|message|content|text|description|details|note|notes|summary|comment|instructions)/.test(
    name,
  );

  if (!wholeMessage) {
    const quoted = text.match(/["“]([^"”]{2,})["”]/);
    if (quoted) return quoted[1];

    const labelled = text.match(
      /\b(called|named|titled|entitled|subject|caption|saying|reading)\s+[:：]?\s*([^.,;!?\n]{2,})/i,
    );
    if (labelled) return labelled[2].trim();
  }

  if (wholeMessage) return text.trim();
  return null;
}

/** Classify a date parameter name as the start or end of a range. */
function dateKind(name: string): "start" | "end" | null {
  const tokens = name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (tokens.some((t) => ["start", "from", "begin", "since"].includes(t)))
    return "start";
  if (
    tokens.some((t) =>
      ["end", "until", "asof", "through", "thru", "of"].includes(t),
    )
  )
    return "end";
  if (tokens.includes("to")) return "end";
  return null;
}

function extractDate(param: ToolParam, text: string): string | null {
  const range = resolveRange(text);
  if (!range) return null;

  const kind = dateKind(param.name);
  if (kind === "start") return range.start;
  if (kind === "end") return range.end;
  return resolveDate(text) ?? range.start;
}

export function extractParams(
  toolId: string,
  text: string,
  params: ToolParam[],
  fallback?: Record<string, unknown>,
): ExtractionResult {
  const values: Record<string, unknown> = {};
  const out: ExtractedParam[] = [];
  const missingRequired: string[] = [];

  for (const p of params) {
    let value: unknown = null;
    let source: ExtractedParam["source"] = "missing";

    if (p.enum && p.enum.length) {
      const e = matchEnum(text, p.enum);
      if (e) {
        value = e;
        source = "extracted";
      }
    } else if (looksEmail(p)) {
      const e = extractEmail(text);
      if (e) {
        value = e;
        source = "extracted";
      }
    } else if (looksDate(p)) {
      const d = extractDate(p, text);
      if (d) {
        value = d;
        source = "extracted";
      }
    } else if (p.type === "number") {
      const n = firstNumber(text);
      if (n !== null) {
        value = n;
        source = "extracted";
      }
    } else if (p.type === "boolean") {
      const b = extractBoolean(text);
      if (b !== null) {
        value = b;
        source = "extracted";
      }
    } else if (p.type === "string") {
      const s = extractString(p, text);
      if (s) {
        value = s;
        source = "extracted";
      }
    }

    // A previously stored/clarified value (session.parameters) is the fallback
    // when the text didn't resolve the argument — workflow-style consume-by-name.
    if (source === "missing" && fallback && fallback[p.name] !== undefined) {
      value = fallback[p.name];
      source = "clarified";
    }

    if (source === "missing" && p.default !== undefined) {
      value = p.default;
      source = "default";
    }

    if (source === "missing" && p.required) {
      missingRequired.push(p.name);
    }

    if (source !== "missing") values[p.name] = value;
    out.push({ name: p.name, value, source });
  }

  return { values, params: out, missingRequired };
}
