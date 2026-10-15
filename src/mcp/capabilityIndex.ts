/**
 * Capability index — a startup-built, cached consolidation of the chat-facing
 * capability surface: every app skill (and the tools it declares) plus every
 * built-in MCP tool (name, server, description, input schema, and result
 * contract). Built lazily on first use (after `initMcp` registers the servers)
 * and cached, so per-request paths never re-list tools or re-parse skills.
 *
 * No workspace dependency — this is application-level skills + built-in tools
 * only (curated capabilities; external MCP connections were retired).
 */

import { aggregator } from "./aggregator";
import { resultContract, type ResultContract } from "./outputs";
import { loadAppSkills, declaredTools } from "../core/skills/loader";

export interface CapabilityTool {
  name: string;
  server: string;
  description: string;
  inputSchema: unknown;
  output: ResultContract;
}

export interface CapabilitySkill {
  name: string;
  description: string;
  tools: string[];
}

export interface CapabilityIndex {
  tools: Map<string, CapabilityTool>;
  skills: Map<string, CapabilitySkill>;
}

let index: CapabilityIndex | null = null;

export async function getCapabilityIndex(): Promise<CapabilityIndex> {
  if (index) return index;

  const tools = await aggregator.getAllTools();
  const serverMap = aggregator.getToolServerMap();

  const toolMap = new Map<string, CapabilityTool>();
  for (const t of tools as any[]) {
    toolMap.set(t.name, {
      name: t.name,
      server: serverMap.get(t.name) ?? "?",
      description: t.description || "",
      inputSchema: t.inputSchema,
      output: resultContract(t.name),
    });
  }

  const skills = loadAppSkills();
  const skillMap = new Map<string, CapabilitySkill>();
  for (const s of skills) {
    skillMap.set(s.name, {
      name: s.name,
      description: s.description || "",
      tools: declaredTools(s.content),
    });
  }

  index = { tools: toolMap, skills: skillMap };
  return index;
}

export function resetCapabilityIndex(): void {
  index = null;
}
