// localIdentity — the single-user identity used by EDITION=local.
//
// No login, no Supabase. The exe runs as one fixed user derived from ADMIN_USER,
// with deterministic userId/databaseId and full authority. LLM provider/model
// come from the environment (or the Settings panel, which persists to
// KEYSTORE=file). This is the AUTH=none seam (see ARCHITECTURE-DECISIONS.md §14).

import type { UserContextData } from "@backend/core/context";

export const LOCAL_USER_ID = "local";
export const LOCAL_DATABASE_ID = "local";

export function localUserContext(): UserContextData {
  const email = (process.env.ADMIN_USER || "local@workflowpeople.local").trim();
  return {
    userId: LOCAL_USER_ID,
    authUserId: LOCAL_USER_ID,
    userEmail: email,
    userName: email.split("@")[0] || "Local User",
    isAdmin: 1,
    isAuthenticated: true,
    darkMode: false,
    currentDatabaseId: LOCAL_DATABASE_ID,
    workspaceName: "My Workspace",
    llmProvider: process.env.LLM_API_PROVIDER || process.env.LLM_PROVIDER || "",
    llmModel: process.env.LLM_MODEL || "",
    currentChatMode: "build",
    chatVerbose: true,
    // Solo: always full access (mirrors toContextData authority values).
    wfAndChat: 2, // WfAndChatAuthority.Designer
    wfMngmt: 2, // WfMngmtAuthority.Approver
    practiceMgmt: 1, // PracticeMgmtAuthority.Admin
  };
}

export function isLocalUserId(userId: string): boolean {
  return userId === LOCAL_USER_ID;
}
