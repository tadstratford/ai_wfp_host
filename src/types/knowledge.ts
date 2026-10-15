export type KnowledgeScope =
  | "chat"
  | "workflow"
  | "chat+workflow"
  | "privacy-map";

export interface KnowledgePack {
  name: string;
  scope: KnowledgeScope;
  tags?: string[];
  /** Markdown body for chat/workflow packs; a JSON string of `[real, fake]` pairs for privacy-map packs. */
  content: string | string[];
  created_at?: string;
  updated_at?: string;
}
