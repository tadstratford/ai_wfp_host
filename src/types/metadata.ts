export interface WorkspaceNote {
  text: string;
  created_at: string;
}

export interface Metadata {
  format_version: string;
  workspace: string;
  spec_url?: string;
  exported_at?: string;
  period?: string;
  notes?: WorkspaceNote[];
  modules?: string[];
  /** Identity-shell reference — the engagement this file belongs to. */
  engagement_id?: string;
  /** Identity-shell reference — the team responsible for this file. */
  team_id?: string;
}
