/**
 * Clarification question builder.
 *
 * When a planner can't resolve a required tool argument, it returns a `clarify`
 * result instead of guessing (or falling back to an LLM that would guess). The
 * orchestrator turns that result into a free-text question for the user. This
 * module builds the question text from the missing params' schemas so every
 * tool gets a readable prompt without a bespoke template.
 */

import { getToolParams, type ToolParam } from "../extract/schema";
import { extractParams } from "../extract/extract";
import { setParameterValue } from "@backend/core/settings/parameterHelpers";

/** Build a readable free-text question from `toolId.param` missing entries. */
export async function buildClarifyQuestion(missing: string[]): Promise<string> {
  const byTool = new Map<string, string[]>();
  for (const entry of missing) {
    const dot = entry.indexOf(".");
    const toolId = dot >= 0 ? entry.slice(0, dot) : entry;
    const param = dot >= 0 ? entry.slice(dot + 1) : entry;
    const list = byTool.get(toolId) ?? [];
    if (!list.includes(param)) list.push(param);
    byTool.set(toolId, list);
  }

  const parts: string[] = [];
  for (const [toolId, paramNames] of byTool) {
    const params = await getToolParams(toolId);
    for (const name of paramNames) {
      const p = params.find((x) => x.name === name);
      parts.push(p?.description || name.replace(/_/g, " "));
    }
  }

  return (
    "I need a bit more information to proceed. Please provide:\n" +
    parts.map((p) => `- ${p}`).join("\n")
  );
}

/** Split a `toolId.param` entry into its two parts. */
function splitMissing(entry: string): { toolId: string; param: string } {
  const dot = entry.indexOf(".");
  return dot >= 0
    ? { toolId: entry.slice(0, dot), param: entry.slice(dot + 1) }
    : { toolId: entry, param: entry };
}

/** Infer a WFP envelope type from a param's declared type + resolved value. */
function metaTypeFor(p: ToolParam | undefined, value: unknown): string {
  if (p?.type === "number") return "number";
  if (p?.type === "boolean") return "boolean";
  if (p?.type === "array") return "json_array";
  if (p?.type === "object") return "json_object";
  return typeof value === "number" ? "number" : "string";
}

/**
 * Resolve a clarification reply into typed parameter values, keyed by bare param
 * name, and store them in `session.parameters` (the same typed store the workflow
 * pause form uses). Returns the resolved record so the re-run can consume the
 * values by name rather than only re-parsing free text.
 */
export async function persistClarifiedParams(
  session: any,
  missing: string[],
  reply: string,
): Promise<Record<string, unknown>> {
  const byTool = new Map<string, string[]>();
  for (const entry of missing) {
    const { toolId, param } = splitMissing(entry);
    const list = byTool.get(toolId) ?? [];
    if (!list.includes(param)) list.push(param);
    byTool.set(toolId, list);
  }

  const clarified: Record<string, unknown> = {};
  for (const [toolId, paramNames] of byTool) {
    const params = await getToolParams(toolId);
    const { values } = extractParams(toolId, reply, params);
    for (const name of paramNames) {
      const value = values[name];
      if (value === undefined) continue;
      const p = params.find((x) => x.name === name);
      const type = metaTypeFor(p, value);
      session.parameters = setParameterValue(session.parameters, name, {
        _meta: { type, source: "clarify" },
        data: value,
      });
      clarified[name] = value;
    }
  }
  return clarified;
}
