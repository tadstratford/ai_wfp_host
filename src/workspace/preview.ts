// Pure .wfp preview — parses a JSON payload (or encryption envelope) and
// returns a summary without writing anywhere. Replaces the previewWorkspace
// export from the deleted fileFormat.ts.

import { isEncryptedEnvelope } from "./crypto";
import type {
  DataEntry,
  KnowledgePack,
  Session,
  Tool,
  Workflow,
} from "wfp-format";

export interface WfpPreview {
  formatVersion: string;
  encrypted: boolean;
  workspaceName: string | null;
  workflows: { name: string; nodeCount: number }[];
  customTools: { name: string; hasCode: boolean }[];
  knowledgePacks: { name: string; scope: string }[];
  sessions: number;
  userDataFiles: { name: string; sizeKb: number }[];
  hasCustomCode: boolean;
}

export function previewWorkspace(fileContent: string): WfpPreview {
  if (isEncryptedEnvelope(fileContent)) {
    return {
      formatVersion: "encrypted",
      encrypted: true,
      workspaceName: null,
      workflows: [],
      customTools: [],
      knowledgePacks: [],
      sessions: 0,
      userDataFiles: [],
      hasCustomCode: false,
    };
  }

  const parsed = JSON.parse(fileContent.trim()) as Record<string, unknown>;
  const meta = (parsed.metadata ?? {}) as Record<string, unknown>;

  const workflows = ((parsed.workflows as Workflow[] | undefined) ?? []).map((w) => ({
    name: w.name || "Unnamed",
    nodeCount: Array.isArray(w.nodes) ? w.nodes.length : 0,
  }));

  const customTools = ((parsed.tools as Tool[] | undefined) ?? []).map((t) => ({
    name: t.name || "Unnamed",
    hasCode: !!(t.code && t.code.trim()),
  }));

  const knowledgePacks = ((parsed.knowledge as KnowledgePack[] | undefined) ?? []).map((p) => ({
    name: p.name || "Unnamed",
    scope: p.scope || "chat+workflow",
  }));

  const sessions = ((parsed.sessions as Session[] | undefined) ?? []).length;

  const dataMap = (parsed.data as Record<string, DataEntry> | undefined) ?? {};
  const userDataFiles = Object.entries(dataMap).map(([name, entry]) => ({
    name,
    sizeKb: Math.round(
      (typeof entry.content === "string" ? entry.content.length : 0) / 1024,
    ),
  }));

  return {
    formatVersion: (meta.format_version as string) ?? "unknown",
    encrypted: false,
    workspaceName: (meta.workspace as string) ?? null,
    workflows,
    customTools,
    knowledgePacks,
    sessions,
    userDataFiles,
    hasCustomCode: customTools.some((t) => t.hasCode),
  };
}
