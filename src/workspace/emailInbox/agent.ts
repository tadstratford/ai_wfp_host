// inboundEmail/agent — headless email processing via the chat orchestrator.
//
// An inbound email becomes a user message in a fresh chat session and is run
// through `handleMessage(...)` (src/chat/vers_6) in "email" mode. The chat
// orchestrator figures out which workflow to run and runs it (via the
// `run_workflow` MCP tool), and the workflow's own `send_email` / `workflow_audit`
// nodes decide the reply and the terminal email status.
//
// Workspace resolution: inbound email ALWAYS opens the workspace headlessly
// under a SYNTHETIC shadow identity (`<userId>::email-agent` /
// `<databaseId>::email-agent`), independent of any logged-in owner session. This
// keeps the inbound path fully session-independent. Shadow opens are
// plaintext-only; encrypted/closed workspaces are marked `failed` for review.

import {
  createSession,
  getSession,
  updateSession,
} from "@backend/core/session/sessions/session_all";
import {
  openWorkspaceAsShadow,
  closeActiveWorkspace,
  refreshActiveWorkspaceIfStale,
} from "@backend/core/workspace/workspaceLifecycle";
import { isWorkspaceEncrypted } from "@backend/core/workspace/workspaceStore";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import {
  updateEmailStatus,
  linkEmailSession,
  listAttachments,
  getEmail,
} from "./store";
import { sendWorkspaceEmail } from "./outbound";
import { revealFullAddress } from "./address";
import type { InboundAddress, InboundEmail } from "./types";
import { SHADOW_SUFFIX } from "./identity";

type WorkspaceResolution =
  | { ok: true; databaseId: string; userId: string; shadow: boolean }
  | { ok: false; reason: string };

async function resolveWorkspace(
  address: InboundAddress,
): Promise<WorkspaceResolution> {
  if (!address.database_id) {
    return { ok: false, reason: "no database_id on address" };
  }

  if (await isWorkspaceEncrypted(address.workspace_id)) {
    return { ok: false, reason: "encrypted workspace — open it to process" };
  }

  // Always open under a synthetic shadow identity so the owner's interactive
  // session (whether the same workspace is open or none) is never touched.
  const shadowUserId = `${address.user_id}${SHADOW_SUFFIX}`;
  const shadowDatabaseId = `${address.database_id}${SHADOW_SUFFIX}`;
  try {
    await openWorkspaceAsShadow({
      userId: shadowUserId,
      databaseId: shadowDatabaseId,
      workspaceId: address.workspace_id,
      secret: null,
    });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true, databaseId: shadowDatabaseId, userId: shadowUserId, shadow: true };
}

/**
 * Close the shadow session (if any) and re-hydrate the real owner's live
 * session (if one is open on this workspace) so the session the agent just
 * created is immediately visible — otherwise their in-memory copy stays stale.
 */
async function teardownShadow(
  address: InboundAddress,
  userId: string,
  shadow: boolean,
): Promise<void> {
  if (shadow) await closeActiveWorkspace(userId, "switch");
  if (address.database_id) {
    try {
      await refreshActiveWorkspaceIfStale(address.database_id);
    } catch (err) {
      console.error("[email-agent] owner session refresh failed:", err);
    }
  }
}

/**
 * Process an inbound email headlessly. Runs the chat orchestrator in "email"
 * mode; the model picks and runs a workflow, which sets the terminal email
 * status. If it leaves the email mid-flight, mark it failed (fail-closed).
 */
export async function processInboundEmail(
  email: InboundEmail,
  address: InboundAddress,
): Promise<void> {
  const resolved = await resolveWorkspace(address);
  if (!resolved.ok) {
    console.log(`[email-agent] failed ${email.email_id}: ${resolved.reason}`);
    await updateEmailStatus(email.email_id, "failed", resolved.reason);
    return;
  }

  const databaseId = resolved.databaseId;
  const userId = resolved.userId;
  const subject = email.subject || "(no subject)";

  const session = await createSession(databaseId, userId, `Email: ${subject}`);
  const sessionId = session.session_id;

  const attachments = await listAttachments(email.email_id);
  const attachmentLines = attachments
    .map((a) => `- ${a.filename ?? "attachment"} (id: ${a.attachment_id}, ${a.mime_type ?? "?"}, ${a.size_bytes ?? 0} B)`)
    .join("\n");

  const message = [
    `From: ${email.from_email ?? "unknown"}`,
    `Subject: ${subject}`,
    `Date: ${email.date ?? ""}`,
    ``,
    email.entry?.textBody ?? email.entry?.htmlBody ?? "",
    ``,
    `---`,
    `email_id: ${email.email_id}`,
    attachmentLines ? `Attachments:\n${attachmentLines}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  await updateEmailStatus(email.email_id, "in_progress");
  await linkEmailSession(email.email_id, sessionId);

  try {
    const { handleMessage } = await import("@chat/index");
    await handleMessage(databaseId, sessionId, userId, message, "", "email");
  } catch (err) {
    console.error(`[email-agent] run failed for ${email.email_id}:`, err);
    await updateEmailStatus(email.email_id, "failed", err instanceof Error ? err.message : String(err));
    await updateSession(databaseId, sessionId, "instance_status", "blocked");
    await teardownShadow(address, userId, resolved.shadow);
    return;
  }

  // Autonomous run — land on a completed terminal status (no feedback to await).
  await updateSession(databaseId, sessionId, "instance_status", "completed");
  notifyClients(sessionId, "workflow_complete");

  // The workflow is trigger-agnostic — it produces a report (or not) and ends
  // with `workflow_audit`. This adapter maps the audit verdict to the email's
  // terminal status and, on a pass, emails the report back to the sender.
  // A failed (or missing) verdict never emails the report out — fail-closed.
  try {
    const after = await getEmail(email.workspace_id, email.email_id);
    const wfSessionId = after?.session_id;
    if (wfSessionId) {
      const wfSession = await getSession(databaseId, wfSessionId);
      const msgs = (wfSession?.messages ?? []) as any[];
      const verdict = msgs
        .map((m) => {
          const a = m?.json?.workflowAudit ?? m?.json?.successFactorAudit;
          if (a?.statusReason) return a.statusReason === "no_errors" ? "pass" : "failed";
          return a?.verdict;
        })
        .find((v) => v === "pass" || v === "failed");
      const reportHtml = msgs
        .map((m) => m?.json?.reportHtml)
        .find((h) => typeof h === "string" && h.length > 0);
      const stillPending = after?.status === "in_progress" || after?.status === null;

      if (verdict === "failed") {
        await updateEmailStatus(email.email_id, "failed", "workflow audit failed — reply withheld");
      } else if (verdict === "pass" && stillPending) {
        if (reportHtml && email.from_email) {
          const sent = await sendWorkspaceEmail(email.workspace_id, {
            to: email.from_email,
            subject: `Re: ${email.subject || "your request"}`,
            text: "Your requested report is attached and shown below.",
            html: reportHtml,
            replyTo: revealFullAddress(address) || undefined,
            attachments: [{
              filename: "report.html",
              content: Buffer.from(reportHtml, "utf-8").toString("base64"),
            }],
          });
          if (sent.success) {
            await updateEmailStatus(email.email_id, "processed");
          } else {
            await updateEmailStatus(email.email_id, "failed", sent.message);
          }
        } else {
          // Passed audit, no report to reply with — just close the email out.
          await updateEmailStatus(email.email_id, "processed");
        }
      }
      // No verdict → fall through to the fail-closed check below.
    }
  } catch (err) {
    console.error(`[email-agent] auto-reply failed for ${email.email_id}:`, err);
  }

  // Fail-closed: the workflow must set a terminal email status (processed or
  // failed). If it left the email mid-flight, mark it failed for review.
  try {
    const after = await getEmail(email.workspace_id, email.email_id);
    if (after && (after.status === "in_progress" || after.status === null)) {
      await updateEmailStatus(
        email.email_id,
        "failed",
        "workflow completed without setting a terminal email status",
      );
    }
  } catch (err) {
    console.error(`[email-agent] status read failed for ${email.email_id}:`, err);
  }

  await teardownShadow(address, userId, resolved.shadow);
}
