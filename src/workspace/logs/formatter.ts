import type { LLMLogEntry } from "wfp-format/logs";

export function formatLogMarkdown(log: LLMLogEntry): string {
  const lines: string[] = [];

  lines.push(`# LLM API Call Log`);
  lines.push("");
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Timestamp | ${log.created_at} |`);
  lines.push(`| Provider  | ${log.provider} |`);
  lines.push(`| Model     | ${log.model} |`);
  if (log.mode) {
    lines.push(`| Mode      | ${log.mode} |`);
  }
  if (log.providerResponseId) {
    lines.push(`| ResponseID | ${log.providerResponseId} |`);
  }
  lines.push(`| Duration  | ${log.durationMs}ms |`);
  lines.push(`| Session   | ${log.sessionId} |`);
  if (log.inputTokens !== undefined && log.outputTokens !== undefined) {
    lines.push(`| Tokens    | ${log.inputTokens} in / ${log.outputTokens} out |`);
  }
  if (!log.success && log.error) {
    lines.push(`| Error     | ${log.error} |`);
  }
  lines.push("");

  lines.push(`## System Prompt`);
  lines.push("");
  lines.push("```text");
  lines.push(log.systemPrompt);
  lines.push("```");
  lines.push("");

  lines.push(`## Messages`);
  lines.push("");
  if (log.messages.length === 0) {
    lines.push("*(no messages captured for this step)*");
    lines.push("");
  } else {
    for (const msg of log.messages) {
      lines.push(`### ${msg.role.toUpperCase()}`);
      lines.push("");
      lines.push(msg.content);
      lines.push("");
    }
  }

  if (log.toolCalls.length > 0) {
    lines.push(`## Tool Calls`);
    lines.push("");
    for (const tc of log.toolCalls) {
      lines.push(`- **${tc.name}**`);
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(tc.args));
      lines.push("```");
      lines.push("");
    }
  }

  if (log.error) {
    lines.push(`## Error`);
    lines.push("");
    lines.push(log.error);
    lines.push("");
  } else {
    lines.push(`## Response`);
    lines.push("");
    lines.push(log.responseText);
    lines.push("");
  }

  if (log.rawRequest) {
    lines.push(`## Raw Request *(JSON sent to API)*`);
    lines.push("");
    lines.push("```json");
    try {
      lines.push(JSON.stringify(JSON.parse(log.rawRequest), null, 2));
    } catch {
      lines.push(log.rawRequest);
    }
    lines.push("```");
    lines.push("");
  }

  if (log.rawResponse) {
    lines.push(`## Raw Response *(JSON from API)*`);
    lines.push("");
    lines.push("```json");
    try {
      lines.push(JSON.stringify(JSON.parse(log.rawResponse), null, 2));
    } catch {
      lines.push(log.rawResponse);
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}
