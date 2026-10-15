import { getWorkspaceSession } from "@backend/core/workspace/workspaceSessionStore";
import { getSessionOrigin } from "@backend/core/workspace/workspaceLifecycle";

export function activeShellId(userId: string): string {
  const s = getWorkspaceSession(userId);
  const o = s ? getSessionOrigin(s) : undefined;
  return o?.kind === "supabase" ? o.workspaceId : "";
}

export function shellChatUrl(wsId: string, query: string): string {
  return `/app/chat?${query}`;
}

export function shellChatListUrl(wsId: string): string {
  return "/app/chat";
}

export function shellWorkflowsUrl(wsId: string, query?: string): string {
  return "/app/overview";
}
