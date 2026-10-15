import { Context } from "hono";
import type { User } from "@backend/types";
import { marked } from "marked";
import type { LLMLogEntry } from "wfp-format/logs";
import { getLog } from "@backend/core/workspace/logs";
import { SERVER_NAME } from "@backend/core/settings/instanceConfig";

/** Render a role label + markdown body as an HTML string. */
function renderMessagesHtml(messages: Array<{ role: string; content: string }>): string {
  if (!messages || messages.length === 0) return '<p class="text-ink-400">*(no messages)*</p>';
  const blocks = messages.map((m) => {
    const body = marked.parse(m.content || "", { async: false }) as string;
    return `<div class="mb-4"><div class="text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400 mb-1">${escapeHtml(
      m.role,
    )}</div><div class="prose prose-sm dark:prose-invert max-w-none">${body}</div></div>`;
  });
  return blocks.join("");
}

function renderSystemPromptHtml(system: string | undefined, label = "System prompt"): string {
  if (!system) return "";
  const body = marked.parse(system, { async: false }) as string;
  return `<details class="mb-3 rounded-lg border border-ink-200 dark:border-ink-700 bg-white/50 dark:bg-white/5"><summary class="cursor-pointer px-3 py-2 text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400 select-none">${label}</summary><div class="px-3 pb-3 prose prose-sm dark:prose-invert max-w-none">${body}</div></details>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function panel(title: string, subtitle: string, bodyHtml: string): string {
  return `<section class="rounded-xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-[#1D2633] overflow-hidden">
    <header class="px-4 py-2.5 border-b border-ink-200 dark:border-ink-700 flex items-center justify-between gap-2">
      <h2 class="text-sm font-bold text-ink dark:text-white">${title}</h2>
      <span class="text-[11px] text-ink-400 dark:text-ink-500">${subtitle}</span>
    </header>
    <div class="p-4 overflow-auto max-h-[70vh]">${bodyHtml}</div>
  </section>`;
}

function toolCallsHtml(toolCalls: Array<{ name: string; args: unknown }>): string {
  if (!toolCalls || toolCalls.length === 0) return "";
  const items = toolCalls
    .map(
      (tc) =>
        `<details class="mb-2"><summary class="cursor-pointer text-xs font-semibold text-ink-600 dark:text-ink-300">tool · ${escapeHtml(
          tc.name,
        )}</summary><pre class="mt-1 text-xs whitespace-pre-wrap bg-ink-100 dark:bg-black/30 rounded p-2">${escapeHtml(
          JSON.stringify(tc.args ?? null, null, 2),
        )}</pre></details>`,
    )
    .join("");
  return items;
}

function extractTextFromRaw(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const candidate =
      data?.text ??
      data?.content ??
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      data?.output_text;
    return typeof candidate === "string" ? candidate : null;
  } catch {
    return null;
  }
}

export const logCompareView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const logId = c.req.param("logId");

  if (!databaseId) {
    return c.html(
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Masked Log — {SERVER_NAME}</title>
          <link rel="stylesheet" href="/public/css/tailwind.css" />
        </head>
        <body class="bg-[#F3F5F9] dark:bg-[#141A23] min-h-screen text-ink dark:text-white p-8">
          <p class="text-coral-600">No workspace open.</p>
        </body>
      </html>,
    );
  }

  let log: LLMLogEntry | null = null;
  try {
    log = getLog(databaseId, logId);
  } catch (err) {
    console.error("[logCompare] Failed to load log:", err);
  }

  if (!log) {
    return c.html(
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Log Archived — {SERVER_NAME}</title>
          <link rel="stylesheet" href="/public/css/tailwind.css" />
        </head>
        <body class="bg-[#F3F5F9] dark:bg-[#141A23] min-h-screen text-ink dark:text-white">
          <div class="max-w-2xl mx-auto px-4 py-16 md:px-8 text-center">
            <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white mb-3">Log Archived</h1>
            <p class="text-sm text-ink-500">
              This log entry is no longer available. LLM call logs are kept in memory for the current chat session only.
            </p>
            <p class="text-xs text-ink-400 dark:text-ink-500 mt-2">Log ID: {logId}</p>
          </div>
        </body>
      </html>,
    );
  }

  // Raw (unmasked) input — always captured.
  const rawInputHtml =
    renderSystemPromptHtml(log.systemPrompt) +
    renderMessagesHtml(log.messages);

  // Obfuscated input — prefer the structured masked fields; fall back to raw for
  // logs recorded before these fields existed.
  const hasMasked = log.maskedMessages && log.maskedMessages.length > 0;
  const maskedInputHtml = hasMasked
    ? renderSystemPromptHtml(log.maskedSystemPrompt) + renderMessagesHtml(log.maskedMessages!)
    : `<p class="text-ink-400">*(masked input not captured for this log)*</p>`;

  // Raw LLM output — obfuscated model text before unmasking.
  const rawOutputText = log.responseTextMasked ?? extractTextFromRaw(log.rawResponse);
  const rawToolCalls = log.toolCallsMasked ?? log.toolCalls;
  const rawOutputHtml = rawOutputText
    ? `<div class="prose prose-sm dark:prose-invert max-w-none">${marked.parse(rawOutputText, { async: false }) as string}</div>` +
      toolCallsHtml(rawToolCalls)
    : toolCallsHtml(rawToolCalls) ||
      `<p class="text-ink-400">*(no output captured — see <a href="/app/logs/${escapeHtml(logId)}" class="underline">original log</a>)*</p>`;

  // De-obfuscated output.
  const deObfuscatedHtml = log.responseText
    ? `<div class="prose prose-sm dark:prose-invert max-w-none">${marked.parse(log.responseText, { async: false }) as string}</div>` +
      toolCallsHtml(log.toolCalls)
    : toolCallsHtml(log.toolCalls) ||
      `<p class="text-ink-400">*(no output)*</p>`;

  const subCount = log.substitutionCount ?? (hasMasked ? undefined : 0);
  const metaParts = [log.provider, log.model, log.mode].filter(Boolean).join(" · ");
  const tokenPart =
    log.inputTokens !== undefined && log.outputTokens !== undefined
      ? `${log.inputTokens}→${log.outputTokens} tok`
      : "";
  const isJev = log.kind === "jev";

  const content = `
    <div class="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-8">
      <div class="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 class="text-lg font-extrabold tracking-tight text-ink dark:text-white">${isJev ? "Jev call · side-by-side" : "Masked call · side-by-side"}</h1>
          <p class="text-sm text-ink-500 dark:text-ink-400 mt-0.5">${escapeHtml(metaParts)}</p>
        </div>
        <div class="flex items-center gap-3 text-xs text-ink-500 dark:text-ink-400">
          ${tokenPart ? `<span>${tokenPart}</span>` : ""}
          ${log.durationMs != null ? `<span>${log.durationMs}ms</span>` : ""}
          <span class="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 font-semibold">${subCount ?? "?"} substitutions</span>
          <a href="/app/logs/${escapeHtml(logId)}" class="underline text-blue-500 hover:text-blue-600">view original log</a>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        ${isJev
          ? panel("Jev questions + state (raw)", "structured decision input", rawInputHtml) +
            panel("Jev questions + state (masked)", "sent to TypeSafe", maskedInputHtml) +
            panel("Jev answers (raw)", "as returned by Jev", rawOutputHtml) +
            panel("Jev answers (de-obfuscated)", "used for routing", deObfuscatedHtml)
          : panel("Input transcript (before masking)", "user/assistant text is real; tool results already masked", rawInputHtml) +
            panel("Obfuscated input", "sent to the LLM", maskedInputHtml) +
            panel("Raw LLM output", "as returned by the model", rawOutputHtml) +
            panel("De-obfuscated output", "shown in chat", deObfuscatedHtml)}
      </div>
    </div>
  `;

  return c.html(
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Masked Log — {SERVER_NAME}</title>
        <link rel="stylesheet" href="/public/css/tailwind.css" />
        <style>{`
          body { font-family: 'Inter', system-ui, sans-serif; }
          pre { white-space: pre-wrap; word-wrap: break-word; }
        `}</style>
      </head>
      <body class="bg-[#F3F5F9] dark:bg-[#141A23] min-h-screen text-ink dark:text-white">
        <div dangerouslySetInnerHTML={{ __html: content }} />
      </body>
    </html>,
  );
};
