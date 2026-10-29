/**
 * composeRuleChecks — turn deterministic/classified rules into concrete check
 * steps (tool + args) using the LLM planner.
 *
 * The tier classifier (classifyRule.ts) only picks *which* tool family applies;
 * the actual arguments (which data file, which column, what threshold) are
 * derived here from the rule text + the data inventory by a single structured
 * LLM call. The emitted args are validated against the tool schema (required
 * params present). A rule whose check cannot be validated is downgraded —
 * fail-closed, never a guessed check.
 */

import { z } from "zod";
import { callStructured } from "@backend/core/llm/structured";
import { getToolParams } from "../extract/schema";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { maskText, discoverRequestValues } from "@backend/core/knowledge/autoMask";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { ClassifiedRule, DataStep, DowngradedRule } from "./types";
import { loadConfig } from "./config";

const CheckSchema = z.object({
  checks: z.array(
    z.object({
      rule: z.string(),
      tool: z.string(),
      args: z.record(z.string(), z.unknown()),
    }),
  ),
});

const CHECK_SYSTEM =
  "You convert workspace rules into concrete data checks. Each rule is a constraint that must hold; " +
  "each check runs ONE existing data tool with concrete arguments to verify that rule against the loaded data. " +
  "Use only the data tools: check_data, aggregate_data, compare_data, reconcile_relationship, profile_data, list_data, get_data, classify_data, split_data. " +
  "Derive argument values from the rule text and the listed data-file names — never invent a data-file name. " +
  "A membership/validity rule (\"X must be in the list\", \"coded correctly\") uses check_data with a checks array. " +
  "A footing/sum/50-50 rule uses aggregate_data (or split_data). A tie-out/variance rule uses reconcile_relationship or compare_data.";

export async function composeRuleChecks(opts: {
  databaseId: string;
  userId: string;
  rawMessage: string;
  rules: ClassifiedRule[];
}): Promise<{ steps: DataStep[]; downgraded: DowngradedRule[] }> {
  const checkable = opts.rules.filter((r) => r.tier !== "audit");
  if (checkable.length === 0) return { steps: [], downgraded: [] };

  let dataNames: string[] = [];
  try {
    const ws = getSessionByDatabaseId(opts.databaseId);
    dataNames = ws
      ? ws.getDataNames().filter((n) => ws.getDataEntry(n)?.content_type !== "xlsx")
      : [];
  } catch {
    dataNames = [];
  }

  let privacyMap = loadPrivacyMap(opts.databaseId);
  const probe = { system: "", messages: [{ role: "user", content: opts.rawMessage }] };
  const { added } = discoverRequestValues(opts.databaseId, probe);
  if (added > 0) privacyMap = loadPrivacyMap(opts.databaseId);
  const masked = privacyMap ? maskText(opts.rawMessage, privacyMap) : opts.rawMessage;

  const catalog = checkable
    .map((c) => `- rule "${c.rule.name}" [${c.tier}] tool hint: ${c.tool ?? "none"}\n    ${c.rule.description ?? ""} ${c.rule.content}`)
    .join("\n");

  let parsed: z.infer<typeof CheckSchema> | null;
  try {
    parsed = await callStructured({
      databaseId: opts.databaseId,
      schema: CheckSchema,
      toolName: "emit_rule_checks",
      toolDescription: "Emit the tool checks that verify each workspace rule.",
      system: CHECK_SYSTEM,
      userMessage: `Rules:\n${catalog}\n\nLoaded data files: ${dataNames.join(", ") || "(none)"}\n\nRequest: ${masked}`,
      maxTokens: 2000,
      temperature: loadConfig().llm.temperature,
      callOpts: { userId: opts.userId, mode: "chat", phase: "rule-check" },
    });
  } catch (err: any) {
    const reason = err?.message
      ? `compose failed: ${String(err.message).slice(0, 120)}`
      : "compose failed";
    console.warn(`[vers_11] rule-check compose failed: ${err.message}`);
    return { steps: [], downgraded: checkable.map((c) => ({ rule: c.rule, reason })) };
  }

  if (!parsed) {
    return { steps: [], downgraded: checkable.map((c) => ({ rule: c.rule, reason: "no valid checks emitted" })) };
  }

  const byName = new Map(checkable.map((c) => [c.rule.name, c]));
  const steps: DataStep[] = [];
  const downgraded: DowngradedRule[] = [];
  const handled = new Set<string>();

  for (const check of parsed.checks) {
    const c = byName.get(check.rule);
    if (!c) continue;
    const params = await getToolParams(check.tool);
    const missing = params.filter((p) => p.required && check.args[p.name] === undefined).map((p) => p.name);
    if (missing.length > 0) {
      downgraded.push({ rule: c.rule, reason: `missing ${check.tool}.${missing.join(",")}` });
      handled.add(c.rule.name);
      continue;
    }
    handled.add(c.rule.name);
    steps.push({
      kind: "data",
      tool: check.tool,
      args: check.args,
      label: `Check: ${c.rule.name}`,
      durable: true,
      ruleCheck: c.rule.name,
      tier: c.tier,
      status: "pending",
    });
  }

  // Only rules with no emitted *or* missing-arg check get the generic downgrade —
  // one disclosure per rule, never "missing X" AND "no check emitted" together.
  for (const c of checkable) {
    if (!handled.has(c.rule.name)) {
      downgraded.push({ rule: c.rule, reason: "no check emitted" });
    }
  }

  return { steps, downgraded };
}
