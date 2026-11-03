import type { Metadata } from "./metadata";
import type { Workflow } from "./workflow";
import type { Tool } from "./tool";
import type { DataEntry } from "./data";
import type { DataCatalog } from "./dataCatalog";
import type { KnowledgePack } from "./knowledge";
import type { Session } from "./session";
import type { PlanEntry } from "./plan";
import type { TodoEntry } from "./todo";
import type { SavedPrompt } from "./prompt";
import type { EncryptionEnvelope } from "./encryption";
import type { Rule } from "./rule";
import type { Skill } from "./skill";
import type { StoryArchetype } from "./story";
import type { LLMLogEntry } from "./logs";
import type { ProvenanceEvent } from "./provenance";
import type { PrivacyMask } from "./privacy";
import type { Diary } from "./diary";

export interface WfpFile {
  metadata: Metadata;
  workflows: Workflow[];
  tools?: Tool[];
  data?: Record<string, DataEntry>;
  /** Load-time schema + relationship/lineage index (deterministic + Jev). */
  data_catalog?: DataCatalog;
  knowledge?: KnowledgePack[];
  /** Workspace-authored skills — the unified home for what was `rules[]`. */
  skills?: Skill[];
  /** @deprecated legacy alias for `skills[]`; migrated to `skills[]` on open. */
  rules?: Rule[];
  /** Workspace-authored stories (meta-plans) — layered over the server-shipped
   *  stories; a workspace story with the same id wins. */
  stories?: StoryArchetype[];
  sessions?: Session[];
  plan?: PlanEntry[];
  todos?: TodoEntry[];
  saved_prompts?: SavedPrompt[];
  logs?: LLMLogEntry[];
  /** Append-only change ledger — the "Time Machine" history. */
  provenance?: ProvenanceEvent[];
  /** Real→fake confidentiality map (top-level control node). */
  privacy_mask?: PrivacyMask;
  /** Compacting activity diary — the story of what happened, and by whom. */
  diary?: Diary;
}

export type WfpFileOrEncrypted = WfpFile | EncryptionEnvelope;

export const WFP_FORMAT_VERSION = "1.0.0";
