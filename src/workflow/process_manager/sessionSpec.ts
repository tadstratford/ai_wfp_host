import type { Session } from "@backend/types";
import { loadRules } from "@rules/loader";

/**
 * Flatten a chat session into a "worked example" spec that the conversion
 * planner (`pipeline/planner-convert`) can turn into a reusable workflow.
 *
 * The durable tool-call record lives on `session.metadata.toolCalls`, appended
 * per turn by the chat orchestrator (see vers_8/orchestrator.ts persistToolCalls).
 */

interface ToolCallRecord {
  at?: string;
  tools?: { tool: string; args?: string; wf_indicator?: boolean }[];
}

export function specFromSession(session: Session, databaseId?: string): string {
  const lines: string[] = [];

  // ── Original request(s) ────────────────────────────────────────────────
  const userMessages = (session.messages ?? []).filter(
    (m) => m.role === "user" && (m.markdown || "").trim(),
  );
  if (userMessages.length > 0) {
    lines.push("## What the user asked for");
    for (const m of userMessages) {
      lines.push(`- ${(m.markdown ?? "").trim()}`);
    }
    lines.push("");
  }

  // ── Ordered tool calls (the durable record) ────────────────────────────
  const toolCalls = (session.metadata as any)?.toolCalls as ToolCallRecord[] | undefined;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    lines.push("## What was done (tool calls in order)");
    let i = 1;
    for (const turn of toolCalls) {
      for (const tc of turn.tools ?? []) {
        const tag = tc.wf_indicator === true ? " [durable]" : tc.wf_indicator === false ? " [ephemeral]" : "";
        const argsText =
          tc.args && tc.args.length >= 3999
            ? " — args: (truncated — this call consumes the prior tool's output; wire via {{result}})"
            : tc.args
              ? ` — args: ${tc.args}`
              : "";
        lines.push(`${i}. ${tc.tool}${tag}${argsText}`);
        i++;
      }
    }
    lines.push("");
  }

  // ── Skills & rules that guided the session ────────────────────────────
  const activeSkills = (session.metadata as any)?.lastActiveSkills;
  if (Array.isArray(activeSkills) && activeSkills.length > 0) {
    lines.push("## Active skills");
    lines.push(activeSkills.map((s: string) => `- ${s}`).join("\n"));
    lines.push("");
  }

  if (databaseId) {
    const rules = loadRules(databaseId);
    if (rules.length > 0) {
      lines.push("## Workspace rules");
      for (const r of rules) {
        lines.push(`### ${r.name}`);
        lines.push(r.content);
      }
      lines.push("");
    }
  }

  // ── Final assistant replies (skip progress / LLM-log messages) ─────────
  const replies = (session.messages ?? []).filter(
    (m) => m.role === "assistant" && (m.json as any)?.kind === "reply" && (m.markdown || "").trim(),
  );
  if (replies.length > 0) {
    lines.push("## Final result");
    for (const m of replies.slice(-3)) {
      lines.push((m.markdown ?? "").trim());
    }
    lines.push("");
  }

  // ── Conversion instruction ─────────────────────────────────────────────
  lines.push(
    "Convert the session above into a reusable, parameterized workflow composed " +
      "from the existing tool catalog. The tool calls are tagged `[durable]` (reusable " +
      "workflow steps — keep these) or `[ephemeral]` (exploration, reads, or presentation — " +
      "drop these; data reads may become `{{name}}` inputs). " +
      "Reference loaded data files, `{{result}}` (a prior step's output), and `{{userMessage}}` as variables. " +
      "Derive scalars from the loaded data where possible (a start date from a date column, " +
      "a horizon from the request wording, a threshold that is a definition like zero); keep " +
      "genuinely fixed values as literals. Use `api.pauseForInput` only for a value that cannot " +
      "be derived from data and must be supplied by the user at run time. " +
      "Never emit a `{{name}}` reference that has no provider. " +
      "Carry any `## Rules` from the active skills into the workflow description's `## Rules` " +
      "section as `[deterministic]` / `[audit]` checks (the workflow's own 'presented rules'). " +
      "Do not copy workspace rules in — the terminal `workflow_audit` checks `wfp.rules` directly. " +
      "Dataset-level yes/no checks must use the typed Classifier `check_data`; use `judge_data` only for genuine per-row classification.",
  );

  return lines.join("\n");
}
