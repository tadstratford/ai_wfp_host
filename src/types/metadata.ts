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
}
