/**
 * Capability registry — the consolidated, capability-derived view of the tool
 * surface. Capabilities self-register at module load (side-effect), so the
 * tool policy and the chat orchestrator can answer "what class is this tool?",
 * "is it callable from custom tool code?", "is it a write/durable/report tool?"
 * without hand-maintained allowlists.
 */

import { declareResult } from "../mcp/outputs";
import type {
  CapabilityManifest,
  CapabilityModule,
  CapabilityTool,
  ToolClass,
  ToolDef,
  ToolOutputContract,
} from "./types";

const capabilities = new Map<string, CapabilityModule>();
const tools = new Map<string, ToolDef>();
const toolCapability = new Map<string, string>();

const DEFAULT_OUTPUT: ToolOutputContract = { metaType: "json_object", tabular: false };

export function registerCapability(cap: CapabilityModule): void {
  capabilities.set(cap.manifest.key, cap);
  for (const t of cap.tools) {
    tools.set(t.name, t);
    toolCapability.set(t.name, cap.manifest.key);
    if (t.output) {
      declareResult(t.name, { metaType: t.output.metaType, tabular: t.output.tabular });
    }
  }
}

export function hasTool(name: string): boolean {
  return tools.has(name);
}

export function getToolClass(name: string): ToolClass | undefined {
  return tools.get(name)?.class;
}

export function getToolOutput(name: string): ToolOutputContract {
  return tools.get(name)?.output ?? DEFAULT_OUTPUT;
}

export function getCapabilityForTool(name: string): string | undefined {
  return toolCapability.get(name);
}

/** True when a workflow tool may call this tool via `api.mcp`/`api.callMcp`. */
export function isAllowedFromCustomCode(name: string): boolean {
  const c = tools.get(name)?.class;
  return c === "read" || c === "constructive-write";
}

/** True when invoking this tool requires the chat write-approval gate. */
export function isMutatingTool(name: string): boolean {
  return tools.get(name)?.mutating === true;
}

/** True when this tool's invocation is a durable, reusable workflow step. */
export function isDurableTool(name: string): boolean {
  return tools.get(name)?.durable === true;
}

/** True when this tool produces a self-contained report artifact. */
export function isReportTool(name: string): boolean {
  return tools.get(name)?.report === true;
}

export function listCapabilities(): CapabilityModule[] {
  return Array.from(capabilities.values());
}

export function getCapability(key: string): CapabilityModule | undefined {
  return capabilities.get(key);
}

export function capabilityTools(key: string): ToolDef[] {
  return capabilities.get(key)?.tools ?? [];
}

/** Tool names of a capability, optionally filtered by class. */
export function toolsForCapability(key: string, classes?: ToolClass[]): string[] {
  return capabilityTools(key)
    .filter((t) => !classes || classes.includes(t.class))
    .map((t) => t.name);
}

/** Tool names matching an arbitrary predicate across every capability. */
export function toolNamesWhere(pred: (t: CapabilityTool) => boolean): string[] {
  return Array.from(tools.values())
    .filter(pred)
    .map((t) => t.name);
}

export type { CapabilityManifest };
