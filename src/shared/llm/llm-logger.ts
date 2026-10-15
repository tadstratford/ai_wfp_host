/**
 * LLM API Call Logger
 *
 * Writes a log file for every LLM API call with the full system prompt,
 * message stream, and model response.
 * Files go to: logs/LLM_API_calls/
 */

import * as fs from "fs";
import * as path from "path";
import { dataRoot } from "../dataRoot";

const LOG_DIR = path.join(dataRoot(), "logs", "LLM_API_calls");
const MAX_LOG_FILES = 5;

/** Ensure the log directory exists (created once per process). */
let dirReady = false;
function ensureDir() {
  if (dirReady) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  dirReady = true;
}

/** Generate a timestamped filename: 2026-04-08_14-30-05-123_provider_model.log */
function makeFilename(provider: string, model: string): string {
  const now = new Date();
  const ts = now.toISOString()
    .replace(/T/, "_")
    .replace(/:/g, "-")
    .replace(/\.\d{3}Z/, `-${String(now.getMilliseconds()).padStart(3, "0")}`);
  const safeModel = model.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${ts}_${provider}_${safeModel}.md`;
}

interface LogEntry {
  provider: string;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: any }>;
  tools?: any[];
  response?: {
    text: string;
    usage?: { inputTokens: number; outputTokens: number };
    data?: any;
  };
  error?: string;
  durationMs?: number;
}

/** Delete oldest log files when count exceeds MAX_LOG_FILES. */
function pruneOldLogs(): void {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith(".md"))
      .sort();  // Filenames are timestamped, so alphabetical = chronological
    if (files.length > MAX_LOG_FILES) {
      const toDelete = files.slice(0, files.length - MAX_LOG_FILES);
      for (const f of toDelete) {
        fs.unlinkSync(path.join(LOG_DIR, f));
      }
    }
  } catch {
    // Best-effort cleanup
  }
}

/** Write a single LLM call log file. Fire-and-forget — errors are swallowed. */
export function writeLLMLog(entry: LogEntry): void {
  try {
    ensureDir();

    const lines: string[] = [];
    const divider = "=".repeat(80);

    lines.push(divider);
    lines.push(`LLM API CALL LOG`);
    lines.push(`Timestamp : ${new Date().toISOString()}`);
    lines.push(`Provider  : ${entry.provider}`);
    lines.push(`Model     : ${entry.model}`);
    if (entry.durationMs !== undefined) {
      lines.push(`Duration  : ${entry.durationMs}ms`);
    }
    lines.push(divider);

    // System prompt
    lines.push("");
    lines.push(">>> SYSTEM PROMPT");
    lines.push("-".repeat(80));
    lines.push(entry.systemPrompt);
    lines.push("-".repeat(80));

    // Messages
    lines.push("");
    lines.push(">>> MESSAGES");
    lines.push("-".repeat(80));
    for (const msg of entry.messages) {
      lines.push(`[${msg.role.toUpperCase()}]`);
      const content = typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content, null, 2);
      lines.push(content);
      lines.push("");
    }
    lines.push("-".repeat(80));

    // Tools (if any)
    if (entry.tools && entry.tools.length > 0) {
      lines.push("");
      lines.push(">>> TOOLS");
      lines.push("-".repeat(80));
      lines.push(JSON.stringify(entry.tools, null, 2));
      lines.push("-".repeat(80));
    }

    // Response or error
    lines.push("");
    if (entry.error) {
      lines.push(">>> ERROR");
      lines.push("-".repeat(80));
      lines.push(entry.error);
    } else if (entry.response) {
      lines.push(">>> RESPONSE");
      lines.push("-".repeat(80));
      lines.push(entry.response.text);
      lines.push("-".repeat(80));

      if (entry.response.usage) {
        lines.push("");
        lines.push(">>> TOKEN USAGE");
        lines.push(`Input tokens  : ${entry.response.usage.inputTokens}`);
        lines.push(`Output tokens : ${entry.response.usage.outputTokens}`);
      }

      if (entry.response.data !== undefined && entry.response.data !== null) {
        lines.push("");
        lines.push(">>> PARSED JSON DATA");
        lines.push("-".repeat(80));
        lines.push(JSON.stringify(entry.response.data, null, 2));
      }
    }

    lines.push("");
    lines.push(divider);

    const filename = makeFilename(entry.provider, entry.model);
    fs.writeFileSync(path.join(LOG_DIR, filename), lines.join("\n"), "utf-8");

    // Prune old logs, keeping only the most recent MAX_LOG_FILES
    pruneOldLogs();
  } catch (err) {
    // Never let logging break the app
    console.error("[llm-logger] Failed to write log:", err);
  }
}
