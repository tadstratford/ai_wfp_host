/**
 * Instance-level display config — the firm name and the workspace label,
 * sourced from environment variables (see `.env.example`).
 *
 *   SERVER    → firm/company name shown in the header (fallback "Workflow People")
 *   WORKSPACE → the user-facing word for a workspace (fallback "Workspace")
 *
 * These are display-only labels. They never rename internal identifiers
 * (`WorkspaceSession`, `getWorkspaceSession`, `/app/workspaces`, etc.).
 */

export const SERVER_NAME: string = (process.env.SERVER || "Workflow People").trim();

export const WORKSPACE_LABEL: string = (process.env.WORKSPACE || "Workspace").trim();

export const WORKSPACE_LABEL_PLURAL: string = /s$/i.test(WORKSPACE_LABEL)
  ? WORKSPACE_LABEL
  : `${WORKSPACE_LABEL}s`;
