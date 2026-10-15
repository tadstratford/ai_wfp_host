// emailInbox/mailQuery — grant-scoped, cross-workspace mail reads for the
// server-level Mail dashboard. Unlike store.ts (workspace-scoped CRUD), these
// reads aggregate across the workspaces a user owns or has a whole-workspace
// grant to, plus the user's own company-level inbox (user_id-keyed rows).

import * as db from "../../server/admin/supabase";
import { listWorkspaces } from "@backend/core/workspace/workspaceStore";
import { listSharedWorkspaces } from "@backend/core/workspace/workflowGrants";

const INBOUND_TABLE = "inbound_emails";
const OUTBOUND_TABLE = "outbound_emails";

export interface MailMessage {
  id: string;
  direction: "in" | "out";
  scope: "workspace" | "user";
  workspaceId: string | null;
  workspaceName: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  status: string | null;
  date: string | null;
  threadId: string | null;
  inReplyTo: string | null;
  sessionId: string | null;
  workflowId: string | null;
  workflowName: string | null;
  skillName: string | null;
  auditVerdict: string | null;
}

interface InboundRow {
  email_id: string;
  workspace_id: string | null;
  user_id: string | null;
  from_email: string | null;
  to_address: string | null;
  subject: string | null;
  date: string | null;
  thread_id: string | null;
  status: string | null;
  session_id: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  skill_name: string | null;
  audit_verdict: string | null;
}

interface OutboundRow {
  email_id: string;
  workspace_id: string | null;
  user_id: string | null;
  to_email: string | null;
  subject: string | null;
  reply_to: string | null;
  in_reply_to: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  status: string | null;
  created_at: string;
}

const INBOUND_COLS =
  "email_id,workspace_id,user_id,from_email,to_address,subject,date,thread_id,status,session_id,workflow_id,workflow_name,skill_name,audit_verdict";
const OUTBOUND_COLS =
  "email_id,workspace_id,user_id,to_email,subject,reply_to,in_reply_to,workflow_id,workflow_name,status,created_at";

export interface AccessibleWorkspace {
  id: string;
  name: string;
  updatedAt: string | null;
  ownerEmail: string | null;
  owned: boolean;
}

/** Workspaces this user owns or has a whole-workspace grant to. Metadata-only
 *  (no blob download) for speed. */
export async function listAccessibleWorkspaces(
  userId: string,
): Promise<AccessibleWorkspace[]> {
  const owned = await listWorkspaces(userId).catch(() => []);
  const granted = await listSharedWorkspaces(userId).catch(() => []);
  const map = new Map<string, AccessibleWorkspace>();
  for (const w of owned) {
    map.set(w.workspaceId, {
      id: w.workspaceId,
      name: w.name,
      updatedAt: w.updatedAt ?? null,
      ownerEmail: null,
      owned: true,
    });
  }
  for (const g of granted) {
    if (map.has(g.workspace_id)) continue;
    map.set(g.workspace_id, {
      id: g.workspace_id,
      name: g.workflow_name,
      updatedAt: g.last_accessed_at ?? g.created_at ?? null,
      ownerEmail: g.owner_email,
      owned: false,
    });
  }
  return [...map.values()];
}

export interface WorkspaceOverview {
  id: string;
  name: string;
  ownerEmail: string | null;
  owned: boolean;
  updatedAt: string | null;
  inbound: number;
  outbound: number;
  failed: number;
  processed: number;
}

/** Per-workspace email activity for the server Overview (hypervisor) page. */
export async function listWorkspaceOverviews(userId: string): Promise<WorkspaceOverview[]> {
  const workspaces = await listAccessibleWorkspaces(userId);
  const out: WorkspaceOverview[] = [];
  for (const ws of workspaces) {
    const inbound = await db.select<{ status: string | null }>(INBOUND_TABLE, { workspace_id: ws.id }, "status");
    const inRows = inbound.data ?? [];
    const outbound = await db.select<{ email_id: string }>(OUTBOUND_TABLE, { workspace_id: ws.id }, "email_id");
    out.push({
      id: ws.id,
      name: ws.name,
      ownerEmail: ws.ownerEmail,
      owned: ws.owned,
      updatedAt: ws.updatedAt,
      inbound: inRows.length,
      outbound: (outbound.data ?? []).length,
      failed: inRows.filter((r) => r.status === "failed").length,
      processed: inRows.filter((r) => r.status === "processed").length,
    });
  }
  return out;
}

/** All mail visible to a user: their own inbox, plus inbound/outbound for every
 *  workspace they own or have access to. Newest first. */
export async function listUserMail(userId: string): Promise<MailMessage[]> {
  const workspaces = await listAccessibleWorkspaces(userId);
  const nameById = new Map(workspaces.map((w) => [w.id, w.name]));
  const messages: MailMessage[] = [];

  // User-level inbox (archive-only).
  const userInbound = await db.select<InboundRow>(INBOUND_TABLE, { user_id: userId }, INBOUND_COLS);
  for (const r of userInbound.data ?? []) {
    messages.push({
      id: r.email_id,
      direction: "in",
      scope: "user",
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_id ? nameById.get(r.workspace_id) ?? null : null,
      from: r.from_email,
      to: r.to_address,
      subject: r.subject,
      status: r.status,
      date: r.date,
      threadId: r.thread_id,
      inReplyTo: null,
      sessionId: r.session_id,
      workflowId: r.workflow_id,
      workflowName: r.workflow_name,
      skillName: r.skill_name,
      auditVerdict: r.audit_verdict,
    });
  }

  // User-level outbound (company-level sends, workspace_id = null).
  const userOutbound = await db.select<OutboundRow>(OUTBOUND_TABLE, { user_id: userId }, OUTBOUND_COLS);
  for (const r of userOutbound.data ?? []) {
    messages.push({
      id: r.email_id,
      direction: "out",
      scope: "user",
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_id ? nameById.get(r.workspace_id) ?? null : null,
      from: null,
      to: r.to_email,
      subject: r.subject,
      status: r.status,
      date: r.created_at,
      threadId: null,
      inReplyTo: r.in_reply_to,
      sessionId: null,
      workflowId: r.workflow_id,
      workflowName: r.workflow_name,
      skillName: null,
      auditVerdict: null,
    });
  }

  for (const ws of workspaces) {
    const inbound = await db.select<InboundRow>(INBOUND_TABLE, { workspace_id: ws.id }, INBOUND_COLS);
    for (const r of inbound.data ?? []) {
      messages.push({
        id: r.email_id,
        direction: "in",
        scope: "workspace",
        workspaceId: ws.id,
        workspaceName: ws.name,
        from: r.from_email,
        to: r.to_address,
        subject: r.subject,
        status: r.status,
        date: r.date,
        threadId: r.thread_id,
        inReplyTo: null,
        sessionId: r.session_id,
        workflowId: r.workflow_id,
        workflowName: r.workflow_name,
        skillName: r.skill_name,
        auditVerdict: r.audit_verdict,
      });
    }

    const outbound = await db.select<OutboundRow>(OUTBOUND_TABLE, { workspace_id: ws.id }, OUTBOUND_COLS);
    for (const r of outbound.data ?? []) {
      messages.push({
        id: r.email_id,
        direction: "out",
        scope: "workspace",
        workspaceId: ws.id,
        workspaceName: ws.name,
        from: null,
        to: r.to_email,
        subject: r.subject,
        status: r.status,
        date: r.created_at,
        threadId: null,
        inReplyTo: r.in_reply_to,
        sessionId: null,
        workflowId: r.workflow_id,
        workflowName: r.workflow_name,
        skillName: null,
        auditVerdict: null,
      });
    }
  }

  messages.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return messages;
}

export interface MailDetail {
  id: string;
  direction: "in" | "out";
  scope: "workspace" | "user";
  workspaceName: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  status: string | null;
  date: string | null;
  workflowName: string | null;
  skillName: string | null;
  auditVerdict: string | null;
  sessionId: string | null;
  failReason: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
}

/** Fetch a single mail message (full body + workflow/session) by id, enforcing
 *  the user's access (owned/granted workspace, or the user's own mailbox). */
export async function getMailMessage(userId: string, emailId: string): Promise<MailDetail | null> {
  const workspaces = await listAccessibleWorkspaces(userId);
  const ids = new Set(workspaces.map((w) => w.id));
  const nameById = new Map(workspaces.map((w) => [w.id, w.name]));

  const inRes = await db.selectOne<any>(
    INBOUND_TABLE,
    { email_id: emailId },
    "email_id,workspace_id,user_id,from_email,to_address,subject,date,status,session_id,workflow_name,skill_name,audit_verdict,fail_reason,entry",
  );
  if (inRes.data) {
    const r = inRes.data;
    const accessible = (r.workspace_id && ids.has(r.workspace_id)) || r.user_id === userId;
    if (accessible) {
      const entry = r.entry ?? {};
      return {
        id: r.email_id,
        direction: "in",
        scope: r.workspace_id ? "workspace" : "user",
        workspaceName: r.workspace_id ? nameById.get(r.workspace_id) ?? null : null,
        from: r.from_email,
        to: r.to_address,
        subject: r.subject,
        status: r.status,
        date: r.date,
        workflowName: r.workflow_name,
        skillName: r.skill_name,
        auditVerdict: r.audit_verdict,
        sessionId: r.session_id,
        failReason: r.fail_reason,
        bodyText: entry.textBody ?? null,
        bodyHtml: entry.htmlBody ?? null,
      };
    }
    return null;
  }

  const outRes = await db.selectOne<any>(
    OUTBOUND_TABLE,
    { email_id: emailId },
    "email_id,workspace_id,user_id,to_email,subject,body_text,body_html,reply_to,in_reply_to,workflow_name,status,created_at",
  );
  if (outRes.data) {
    const r = outRes.data;
    const accessible = (r.workspace_id && ids.has(r.workspace_id)) || r.user_id === userId;
    if (accessible) {
      return {
        id: r.email_id,
        direction: "out",
        scope: r.workspace_id ? "workspace" : "user",
        workspaceName: r.workspace_id ? nameById.get(r.workspace_id) ?? null : null,
        from: null,
        to: r.to_email,
        subject: r.subject,
        status: r.status,
        date: r.created_at,
        workflowName: r.workflow_name,
        skillName: null,
        auditVerdict: null,
        sessionId: null,
        failReason: null,
        bodyText: r.body_text,
        bodyHtml: r.body_html,
      };
    }
    return null;
  }

  return null;
}
