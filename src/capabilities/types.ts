/**
 * Capability manifest — the single declaration for a first-class capability.
 *
 * A capability is the curated unit the app exposes to chat and the workflow
 * executor. One folder (`src/capabilities/<key>/`) ships a manifest, its tools
 * (one file per tool under `tools/`), and its skills (markdown under `skills/`).
 * The loader fans the manifest out to the aggregator, the tool registry, the
 * tool policy, workspace scoping, and the skill/group/prompt catalogs — so
 * adding a capability means dropping a folder, not editing each subsystem.
 */

import type { MetaType } from "wfp-api";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** What a tool may do — drives the tool policy (single source of truth). */
export type ToolClass =
  | "read"
  | "constructive-write"
  | "destructive-write"
  | "control";

/** Trust tier — how much the capability is allowed to do. */
export type CapabilityTrust = "core" | "integration" | "external";

/** Delivery form — where the tool implementation lives. */
export type CapabilityKind = "builtin" | "remote";

/** The WFP envelope type of a tool's `result`. */
export interface ToolOutputContract {
  metaType: MetaType;
  tabular: boolean;
}

/** Tool metadata + policy classification (the declarative half of a tool). */
export interface CapabilityTool {
  name: string;
  class: ToolClass;
  /** Omitted → defaults to `{ metaType: "json_object", tabular: false }`. */
  output?: ToolOutputContract;
  /** Mutating side effect — requires the chat write-approval gate. */
  mutating?: boolean;
  /** Durable, reusable workflow step (recorded for "save as workflow"). */
  durable?: boolean;
  /** Produces a self-contained downloadable report artifact. */
  report?: boolean;
}

/** A full tool: its declaration plus its implementation. One per `tools/*.ts`. */
export interface ToolDef extends CapabilityTool {
  description: string;
  /** Zod raw-shape of the tool's arguments. Omitted = no args. */
  inputSchema?: Record<string, unknown>;
  handler: (args: any, extra?: any) => CallToolResult | Promise<CallToolResult>;
}

/** How a capability obtains credentials (OAuth prompt vs inline API key). */
export interface CapabilityAuth {
  type: "oauth2" | "api_key" | "none";
  /** Human label for the key prompt, e.g. "Stripe Secret Key". */
  label?: string;
  /** "Where do I get this?" link shown next to the key input. */
  helpUrl?: string;
  /** HTTP header the key is sent in (api_key auth). */
  header?: string;
  /** Optional value prefix, e.g. "Bearer ". */
  prefix?: string;
}

export interface CapabilityManifest {
  key: string;
  name: string;
  version: string;
  description: string;
  trust: CapabilityTrust;
  kind: CapabilityKind;
  /** Enablement group (maps to skillGroups). */
  group?: { key: string; label: string; defaultEnabled: boolean };
  /** One-click chat capability chip (maps to chatCapabilities). */
  prompt?: string;
  /** App skill names this capability owns (co-located under `skills/`). */
  skills?: string[];
  auth?: CapabilityAuth;
  /** WFP data sections the capability reads/writes (curation-reviewable). */
  dataAccess?: { reads: string[]; writes: string[] };
}

/** A loadable capability: its manifest + its tools + workspace scoping. */
export interface CapabilityModule {
  manifest: CapabilityManifest;
  /** Aggregator server name (e.g. "qbo"). */
  serverName: string;
  /** The capability's tools (auto-discovered from `tools/*.ts`). */
  tools: ToolDef[];
  /** Sets the active workspace scope for this capability's tools. */
  setScope?: (databaseId: string) => void;
}
