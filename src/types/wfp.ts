import type { Metadata } from "./metadata";
import type { Workflow } from "./workflow";
import type { Tool } from "./tool";
import type { DataEntry } from "./data";
import type { KnowledgePack } from "./knowledge";
import type { Session } from "./session";
import type { PlanEntry } from "./plan";
import type { TodoEntry } from "./todo";
import type { SavedPrompt } from "./prompt";
import type { EncryptionEnvelope } from "./encryption";
import type { Rule } from "./rule";
import type { LLMLogEntry } from "./logs";

export interface WfpFile {
  metadata: Metadata;
  workflows: Workflow[];
  tools?: Tool[];
  data?: Record<string, DataEntry>;
  knowledge?: KnowledgePack[];
  rules?: Rule[];
  sessions?: Session[];
  plan?: PlanEntry[];
  todos?: TodoEntry[];
  saved_prompts?: SavedPrompt[];
  logs?: LLMLogEntry[];
}

export type WfpFileOrEncrypted = WfpFile | EncryptionEnvelope;

export const WFP_FORMAT_VERSION = "1.0.0";
