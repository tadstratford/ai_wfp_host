import { addMessage } from "@backend/core/session/messages";
import {
  getSession,
  updateSession,
} from "@backend/core/session/sessions/session_all";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import { processUserMessage, clearResume } from "./orchestrator";
import { setLogHook } from "@backend/core/llm/providers";
import type { AddMessageArgs } from "@backend/types/chat";

const versionNotified = new Set<string>();

export async function handleMessage(
  databaseId: string,
  sessionId: string,
  userId: string,
  rawMessage: string,
  actionValue: string,
  mode: string = "build",
  verbose: boolean = true,
): Promise<void> {
  // keep
  console.log("----------------------------------");
  console.log(`---> SRC/CHAT/VERS_8/INDEX.TS`);
  console.log(`---> databaseId: ${databaseId}`);
  console.log(`---> sessionId: ${sessionId}`);
  console.log(`---> userId: ${userId}`);
  console.log(`---> rawMessage: ${rawMessage}`);
  console.log(`---> actionValue: ${actionValue}`);
  console.log(`---> mode: ${mode}`);
  console.log("----------------------------------");

  let session = await getSession(databaseId, sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  if (!versionNotified.has(sessionId)) {
    versionNotified.add(sessionId);
    session = await addMessage({
      session,
      databaseId,
      role: "assistant",
      source: "system",
      markdown: "> **Chat system**: v8 (Jev skill-first orchestrator)",
      json: { system: true, kind: "system" },
    });
  }

  if (actionValue === "__cancel__") {
    session = await addMessage({
      session,
      databaseId,
      role: "assistant",
      source: "system",
      markdown: "Cancelled.",
    });
    await clearResume(databaseId, sessionId);
    await updateSession(databaseId, sessionId, "metadata", {
      ...(session.metadata ?? {}),
      pendingWrite: undefined,
      pendingClarification: undefined,
    });
    notifyClients(sessionId, "new_message");
    return;
  }

  const lastMsgs = (session.messages || []).slice(-4);
  const isDuplicate = lastMsgs.some(
    (m: any) =>
      m.role === "user" && (m.markdown || "").trim() === rawMessage.trim(),
  );
  if (!isDuplicate) {
    session = await addMessage({
      session,
      databaseId,
      role: "user",
      source: "user",
      markdown: rawMessage,
    });
  }

  await updateSession(databaseId, sessionId, "instance_status", "in_progress");

  setLogHook(async ({ logId, provider, model, inputTokens, outputTokens, phase, iteration, kind }) => {
    const tokenStr = inputTokens != null ? `${inputTokens}\u2192${outputTokens} tok` : "";
    const phaseStr = phase ? (iteration != null ? `${phase} \u00b7 iter ${iteration}` : phase) : "";
    const label = kind === "jev" ? "Jev call" : "LLM call";
    const logUrl = `/app/logs/${logId}`;
    const totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
    const barPct = inputTokens != null ? Math.min(100, Math.round((totalTokens / 20000) * 100)) : 0;
    const barHtml = inputTokens != null
      ? `<span style="display:inline-block;vertical-align:middle;width:96px;height:6px;margin-left:8px;border-radius:9999px;background:rgba(148,163,182,0.35);overflow:hidden;" title="${totalTokens.toLocaleString()} tokens"><span style="display:block;height:100%;border-radius:9999px;background:#3E8DE1;width:${barPct}%"></span></span>`
      : "";
    session = await addMessage({
      session: session!,
      databaseId,
      role: "assistant",
      source: "vers_8",
      html: `${label}${phaseStr ? ` \u00b7 ${phaseStr}` : ""}${tokenStr ? ` \u00b7 ${tokenStr}` : ""} \u00b7 <a href="${logUrl}/masked" target="_blank" class="text-blue-500 hover:underline">view log</a>${barHtml}`,
      json: {
        kind: kind === "jev" ? "jev-call" : "llm-call",
        phase,
        iteration,
        provider,
        model,
        inputTokens,
        outputTokens,
        logId,
      },
    });
  });

  // notifyClients is needed here because updateSession doesn't trigger SSE
  notifyClients(sessionId, "new_message");
  notifyClients(sessionId, "busy_start", "Thinking…");

  try {
    await processUserMessage(rawMessage, session, {
      databaseId,
      userId,
      sessionId,
      workflowId: session.activeWorkflowId as string | undefined,
      mode,
      addMessage: async (msg: AddMessageArgs) => {
        // Re-fetch the FULL session before each save. The plan executor
        // (executePlanInSession) writes step-status / tool / report messages to
        // its own copy of the session and saves it directly; re-fetching here
        // ensures we append to those latest messages instead of overwriting them
        // with this handler's stale copy. (Previously only `metadata` was
        // refreshed, so every message added after a plan ran — the rules audit,
        // the completion summary — silently clobbered the tool output and the
        // report download buttons, which is why nothing appeared after Approve.)
        const latest = await getSession(databaseId, sessionId);
        if (latest) session = latest;
        session = await addMessage({
          session: session!,
          databaseId,
          role: "assistant",
          source: "vers_8",
          markdown: msg.html ? undefined : msg.markdown,
          html: msg.html || undefined,
          json: msg.json,
          id: msg.id,
        });
        notifyClients(sessionId, "new_message");
      },
      addError: async (title: string, detail?: string) => {
        const md = detail ? `**${title}**\n\n${detail}` : `**${title}**`;
        session = await addMessage({
          session: session!,
          databaseId,
          role: "error",
          source: "vers_8",
          markdown: md,
        });
        notifyClients(sessionId, "new_message");
      },
    });
  } catch (err: any) {
    const md = `**vers_8 error**\n\n${err.message || String(err)}`;
    session = await addMessage({
      session: session!,
      databaseId,
      role: "error",
      source: "system",
      markdown: md,
    });
    notifyClients(sessionId, "new_message");
  } finally {
    notifyClients(sessionId, "busy_end");
    setLogHook(null);
    await updateSession(
      databaseId,
      sessionId,
      "instance_status",
      "awaiting_feedback",
    );
    notifyClients(sessionId, "workflow_complete");
  }
}

export function parseCommand(input: string): { command: string } {
  const match = input.match(/^\/(\S+)/);
  return { command: match ? match[1] : "" };
}
