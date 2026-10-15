import { Context } from "hono";
import type { User } from "@backend/types";
import { getWorkspaceSession } from "@backend/core/workspace/workspaceSessionStore";
import { getSessionOrigin } from "@backend/core/workspace/workspaceLifecycle";

/**
 * GET /app — pure redirector. A hosted workspace session open → its shell
 * overview (or Chat when Workflows is hidden); otherwise → the standalone
 * picker (`/app/workspaces`). Legacy `?panel=` params are mapped into the
 * matching section so old URLs resolve.
 */
export const appPage = async (c: Context) => {
  const user = c.get("user") as User;
  const wsSession = getWorkspaceSession(user.userId);
  const wsOrigin = wsSession ? getSessionOrigin(wsSession) : undefined;
  const wsId = wsOrigin?.kind === "supabase" ? wsOrigin.workspaceId : null;
  // A disk-backed (local edition) session is also "open" — land in its shell.
  const isOpen = wsOrigin?.kind === "supabase" || wsOrigin?.kind === "disk";

  if (!isOpen) return c.redirect("/app/workspaces");

  const panel = c.req.query("panel") ?? "";
  if (panel === "workspaces" || panel === "shared") return c.redirect("/app/workspaces");

  const sid = c.req.query("session_id");
  const wfId = c.req.query("workflow_id");
  if (panel === "session" || sid) {
    const qs = (c.req.url.split("?")[1] || "").replace(/(^|&)panel=[^&]*/g, "").replace(/^&/, "");
    return c.redirect(`/app/chat${qs ? `?${qs}` : ""}`);
  }
  if (wfId) return c.redirect("/app/overview");

  const section: Record<string, string> = {
    "": "chat",
    chat: "chat", todos: "overview", dashboard: "overview",
    workflows: "overview", data: "data", knowledge: "overview",
    privacy: "privacy", settings: "overview",
  };
  return c.redirect(`/app/${section[panel] ?? "chat"}`);
};
