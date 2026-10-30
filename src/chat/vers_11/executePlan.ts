/**
 * executePlan — walk the materialized plan, executing each typed step.
 *
 *   data          → run the tool, emit a `step-status` checklist update, record
 *                   evidence, interpret a rule-check flag
 *   communication → emit the message
 *   control       → surface the gate and PAUSE (persist cursor, return)
 *
 * The `approval` control step is BLOCKED when any prior rule-check data step
 * flagged — the plan refuses to proceed until the user cancels or rephrases.
 *
 * On completion, a review-shaped plan renders its deterministic review report
 * (v9's `buildReview`/`renderReviewReport`) and the per-rule check summary.
 */

import { aggregator } from "../../mcp/aggregator";
import { resolveTemplates, setParameterValue } from "@backend/core/settings/parameterHelpers";
import { getSession, updateSession } from "@backend/core/session/sessions/session_all";
import { getCapabilityIndex } from "@mcp/capabilityIndex";
import { isPresentableTool, isMutatingTool } from "../../capabilities/registry";
import { getPlanner } from "./plan/planner";
import type { PlanRequest } from "./plan/planner";
import { COMPOSABLE_PRIMITIVES } from "./plan/primitives";
import { withTimeout } from "./util";
import type { OrchestratorIO } from "./types";
import { buildReview, renderReviewReport, reconcileReviewEvidence } from "./review";
import { loadConfig } from "./config";
import { verifyResultLlm, shouldVerify, verdictPasses } from "./verify";
import type { DataStep, EvidenceItem, RuleTier, TurnPlan } from "./types";

const VERIFIABLE_TOOLS = new Set([
  "aggregate_data", "check_data", "judge_data", "compare_data",
  "reconcile_relationship", "profile_data", "classify_data", "split_data",
]);

function extractTextContent(mcpResult: any): string {
  if (mcpResult?.content && Array.isArray(mcpResult.content)) {
    return mcpResult.content.map((c: any) => c.text || "").filter(Boolean).join("\n");
  }
  if (typeof mcpResult === "string") return mcpResult;
  return JSON.stringify(mcpResult);
}

function parseToolOutput(text: string): unknown {
  if (!text) return text;
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try { return JSON.parse(t); } catch { return text; }
  }
  return text;
}

// ── Present results ─────────────────────────────────────────────────────────
// A presentable tool's result is relayed to the user as markdown. `list_data`
// already returns markdown, so it's relayed verbatim; `get_data` returns
// structured JSON (which stays JSON — the LLM pages through it in other
// orchestrators and workflow nodes consume it), so the executor formats it into
// a compact markdown table here.

const GET_DATA_MAX_ROWS = 25;
const GET_DATA_MAX_COLUMNS = 8;
const GET_DATA_MAX_CELL = 40;
const GET_DATA_MAX_CELLS = 50;

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return truncate(v.map((x) => String(x)).join(", "), GET_DATA_MAX_CELL);
  if (typeof v === "object") return truncate(JSON.stringify(v), GET_DATA_MAX_CELL);
  return truncate(String(v), GET_DATA_MAX_CELL).replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

function tableFromRows(rows: Record<string, unknown>[], hasMore: boolean): string {
  if (rows.length === 0) return "_No rows._";
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, GET_DATA_MAX_COLUMNS);
  const header = `| ${keys.join(" | ")} |`;
  const sep = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows.slice(0, GET_DATA_MAX_ROWS).map((r) => `| ${keys.map((k) => cell(r[k])).join(" | ")} |`);
  const truncated = rows.length > GET_DATA_MAX_ROWS ? `\n\n_Showing ${GET_DATA_MAX_ROWS} of ${rows.length} rows._` : "";
  return [header, sep, ...body].join("\n") + truncated + (hasMore ? "\n\n_More rows available (has_more)._" : "");
}

/** Format a `get_data` result (JSON envelope) as user-facing markdown. */
export function renderGetDataResult(text: string): string {
  if (!text) return text;
  const t = text.trim();
  let value: unknown;
  if (t.startsWith("{") || t.startsWith("[")) {
    try { value = JSON.parse(t); } catch { return text; }
  } else {
    return text;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.tables)) {
      const sections: string[] = [];
      for (const tbl of o.tables) {
        if (!tbl || typeof tbl !== "object") continue;
        const to = tbl as Record<string, unknown>;
        const title = typeof to.name === "string" && to.name ? `**${to.name}**\n\n` : "";
        sections.push(title + renderGetDataResult(JSON.stringify(to)));
      }
      if (Array.isArray(o.missing) && o.missing.length > 0) {
        sections.push(`_Missing: ${(o.missing as string[]).join(", ")}_`);
      }
      return sections.join("\n\n");
    }
    if (Array.isArray(o.rows)) {
      const rows = o.rows.filter(
        (r): r is Record<string, unknown> => r !== null && typeof r === "object" && !Array.isArray(r),
      );
      return tableFromRows(rows, o.has_more === true);
    }
    if (o.cells && typeof o.cells === "object") {
      const cellMap = o.cells as Record<string, unknown>;
      const keys = Object.keys(cellMap);
      const lines = keys.slice(0, GET_DATA_MAX_CELLS).map(
        (k) => `- ${k}: ${typeof cellMap[k] === "string" ? truncate(cellMap[k] as string, GET_DATA_MAX_CELL) : JSON.stringify(cellMap[k])}`,
      );
      const more = keys.length > GET_DATA_MAX_CELLS ? `\n\n_${keys.length - GET_DATA_MAX_CELLS} more cells…_` : "";
      return (lines.length ? lines.join("\n") : "_No cells._") + more;
    }
    if (typeof o.content === "string") return o.content;
    if (typeof o.note === "string" && o.content_type === "xlsx") return o.note;
    return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
  }
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

/** Persist the plan (cursor + step statuses) and, when given, the session
 *  parameters — so a `{{result}}` written before a paused control step resolves
 *  correctly when execution resumes on the next turn. */
export async function persistPlan(io: OrchestratorIO, plan: TurnPlan, parameters?: any): Promise<void> {
  try {
    const fresh = await getSession(io.databaseId, io.sessionId);
    if (!fresh) return;
    await updateSession(io.databaseId, io.sessionId, "metadata", {
      ...(fresh.metadata ?? {}),
      plan,
    });
    if (parameters !== undefined) {
      await updateSession(io.databaseId, io.sessionId, "parameters", parameters);
    }
  } catch (err: any) {
    console.error("[vers_11] persistPlan failed:", err.message);
  }
}

/** The up-front plan card — a numbered checklist of the plan's data steps,
 *  rendered in the right panel and updated live by `step-status` messages. */
export async function emitPlanMessage(io: OrchestratorIO, plan: TurnPlan): Promise<void> {
  const dataSteps = plan.steps.filter((s): s is DataStep => s.kind === "data");
  if (dataSteps.length === 0) return;
  const steps = dataSteps.map((s) => ({ label: s.label, tool_id: s.tool }));
  const stepList = steps.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
  await io.addMessage({
    markdown: `**Steps**\n${stepList}`,
    json: { kind: "plan", planId: plan.id, steps },
  });
}

/** Interpret a rule-check tool's output into a done/flag status. Deterministic:
 *  a reconcile with mismatches/orphans, or a check_data with any noul ≥ 0.6, flags. */
export function interpretRuleCheck(tier: RuleTier | undefined, output: string): "done" | "flag" {
  if (!tier) return "done";
  try {
    const p = JSON.parse(output);
    if (!p || typeof p !== "object") return "done";
    const arr = Array.isArray(p) ? p : [p];
    const nouls = arr.filter((x: any) => typeof x?.noul === "number").map((x: any) => x.noul);
    if (nouls.length > 0) {
      return nouls.some((n) => n >= 0.6) ? "flag" : "done";
    }
    const summ = (arr[0] as any)?.summary ?? {};
    const mismatched = Number(summ.mismatched ?? 0);
    const missing = Number(summ.missing_left ?? 0) + Number(summ.missing_right ?? 0);
    if (mismatched > 0 || missing > 0) return "flag";
  } catch {
    // non-JSON output — not interpretable, treat as done
  }
  return "done";
}

function flaggedRules(plan: TurnPlan): DataStep[] {
  return plan.steps.filter(
    (s): s is DataStep => s.kind === "data" && s.ruleCheck !== undefined && s.status === "flag",
  );
}

/** The per-rule enforcement summary, rendered from the plan's rule-check statuses. */
function renderRuleReport(plan: TurnPlan): string {
  const lines: string[] = [];
  for (const s of plan.steps) {
    if (s.kind !== "data" || !s.ruleCheck) continue;
    if (s.status === "flag") {
      lines.push(`⚠ \`${s.ruleCheck}\` — flagged by ${s.tool}`);
    } else if (s.status === "done") {
      const prefix = s.tier === "classified" ? "classified by" : "checked with";
      lines.push(`✓ \`${s.ruleCheck}\` — ${prefix} ${s.tool}`);
    } else {
      lines.push(`⚠ \`${s.ruleCheck}\` — not proven`);
    }
  }
  return lines.length > 0 ? `**Rule check**\n${lines.join("\n")}` : "";
}

export interface ExecuteOutcome {
  evidence: EvidenceItem[];
  toolsUsed: string[];
  /** True when execution paused at a control step (awaiting the user). */
  paused: boolean;
  /** Non-rule-check data steps that errored (after any re-plan pass). */
  failed: string[];
}

/** Build a fresh one-shot plan over the composable primitives to recover a failed
 *  step. Returns empty when no plan (or no general LLM key) — the failure is then
 *  surfaced to the user instead of looping. */
async function tryReplan(
  opts: { plan: TurnPlan; io: OrchestratorIO; rawMessage: string },
  failed: DataStep[],
): Promise<DataStep[]> {
  try {
    const capability = await getCapabilityIndex();
    const roster = [...capability.tools.values()]
      .filter((t) => COMPOSABLE_PRIMITIVES.includes(t.name))
      .map((t) => ({ name: t.name, description: t.description }));
    const planReq: PlanRequest = {
      databaseId: opts.io.databaseId,
      userId: opts.io.userId,
      sessionId: opts.io.sessionId,
      mode: opts.io.mode,
      rawMessage: `${opts.rawMessage}\n(retry the failed steps: ${failed.map((f) => f.tool).join(", ")})`,
      tools: roster,
      activeSkills: opts.plan.provenance.skills,
      complexity: 0.5,
      mutating: 0,
    };
    const result = await withTimeout(getPlanner("llm").plan(planReq), 60_000, "re-plan");
    if (result.kind !== "plan") return [];
    return result.plan.steps.map((s) => ({
      kind: "data",
      tool: s.tool_id,
      args: s.tool_parameters,
      label: s.label || s.tool_id,
      durable: false,
      status: "pending",
    }));
  } catch (err: any) {
    console.error(`[vers_11] re-plan failed: ${err.message}`);
    return [];
  }
}

export async function executePlan(opts: {
  plan: TurnPlan;
  io: OrchestratorIO;
  session: any;
  rawMessage: string;
  reviewShaped: boolean;
}): Promise<ExecuteOutcome> {
  const evidence: EvidenceItem[] = [];
  const toolsUsed: string[] = [];
  const { plan, io, session } = opts;
  let relationshipsOutput: unknown = null;
  let rendered = false;
  let finalDataTool: string | null = null;
  let finalDataText: string | null = null;
  let lastMutatingTool: string | null = null;
  let lastMutatingText: string | null = null;
  let replyMarkdown = "";

  for (let replans = 0; ; replans++) {
    while (plan.cursor < plan.steps.length) {
      const step = plan.steps[plan.cursor];

      if (step.kind === "communication") {
        step.status = "done";
        rendered = true;
        await io.addMessage(step.message);
        plan.cursor++;
        continue;
      }

      if (step.kind === "control") {
        if (step.control === "approval") {
          const flagged = flaggedRules(plan);
          if (flagged.length > 0) {
            step.status = "blocked";
            await io.addMessage({
              markdown:
                `⚠ Rule checks flagged before this write:\n` +
                flagged.map((f) => `- \`${f.ruleCheck}\``).join("\n") +
                `\nThe write is blocked. Rephrase the request or fix the underlying data, then try again.`,
              json: { kind: "rule-blocked", rules: flagged.map((f) => f.ruleCheck) },
            });
          } else {
            await io.addMessage({
              markdown: step.prompt ?? "Approve to continue.",
              json: { approval: true, planId: plan.id },
            });
          }
        } else {
          await io.addMessage({
            markdown: step.prompt ?? "Clarification needed.",
            json: { kind: "clarify", planId: plan.id },
          });
        }
        await persistPlan(io, plan, session.parameters);
        return { evidence, toolsUsed, paused: true, failed: [] };
      }

      // data step
      step.status = "running";
      const dataIndex = plan.steps.slice(0, plan.cursor).filter((s) => s.kind === "data").length;
      await io.addMessage({
        markdown: step.label,
        json: { kind: "step-status", index: dataIndex, status: "running", label: step.label },
      });
      try {
        const resolved = resolveTemplates(step.args, session.parameters, io.databaseId) as Record<string, unknown>;
        if (
          step.tool === "show_message" &&
          typeof resolved.markdown === "string" &&
          finalDataTool === "get_data" &&
          finalDataText
        ) {
          resolved.markdown = `${resolved.markdown}\n\n${renderGetDataResult(finalDataText)}`;
        }
        const mcpResult = await withTimeout(
          aggregator.callTool(step.tool, resolved),
          loadConfig().loop.toolTimeoutMs,
          `tool ${step.tool}`,
        );
        const full = extractTextContent(mcpResult);
        if (VERIFIABLE_TOOLS.has(step.tool) || isMutatingTool(step.tool)) {
          evidence.push({ tool: step.tool, summary: full.slice(0, 2500) });
        }
        toolsUsed.push(step.tool);
        const resultValue = parseToolOutput(full);
        if (step.tool === "list_relationships") relationshipsOutput = resultValue;
        finalDataTool = step.tool;
        finalDataText = full;
        if (isMutatingTool(step.tool)) {
          lastMutatingTool = step.tool;
          lastMutatingText = full;
        }
        if (step.tool === "show_message" || step.tool === "chat_download") rendered = true;
        session.parameters = setParameterValue(session.parameters, "result", {
          _meta: { type: "text" },
          data: resultValue,
        });
        step.status = step.ruleCheck ? interpretRuleCheck(step.tier, full) : "done";
      } catch (err: any) {
        console.error(`[vers_11] step ${step.tool} error:`, err.message);
        step.status = "error";
      }
      await io.addMessage({
        markdown: step.label,
        json: { kind: "step-status", index: dataIndex, status: step.status, label: step.label },
      });
      await persistPlan(io, plan, session.parameters);
      plan.cursor++;
    }

    // Boundary: attempt ONE re-plan pass for errored non-rule-check steps.
    const failed = plan.steps.filter(
      (s): s is DataStep => s.kind === "data" && !s.ruleCheck && s.status === "error",
    );
    if (failed.length === 0 || replans >= loadConfig().loop.maxReplans) break;
    await io.addMessage({
      markdown: `> _Re-planning ${failed.length} failed step${failed.length === 1 ? "" : "s"}…_`,
      json: { kind: "meta", phase: "replan" },
    });
    const replanSteps = await tryReplan(opts, failed);
    if (replanSteps.length === 0) break;
    for (const s of replanSteps) plan.steps.push(s);
  }

  // ── Finalize: review report (review-shaped) + rule-check summary ──────────
  if (opts.reviewShaped) {
    // Dynamic reconcile + aggregate diff — the valuation/agreement evidence the
    // battery alone doesn't produce (reuses v9's reconciliation phase).
    const reconciled = await reconcileReviewEvidence({
      databaseId: io.databaseId,
      session,
      evidence,
      relationshipsOutput,
    });
    const reviewEvidence = reconciled.evidence;
    const built = buildReview(reviewEvidence, relationshipsOutput, opts.rawMessage);
    if (built) {
      replyMarkdown = built.receipts;
      await io.addMessage({
        markdown: built.receipts,
        json: { kind: "review", review: built.payload, skills: plan.provenance.skills },
      });
    } else {
      const fallback = renderReviewReport(reviewEvidence, relationshipsOutput, opts.rawMessage);
      replyMarkdown = fallback;
      await io.addMessage({ markdown: fallback, json: { kind: "reply", skills: plan.provenance.skills } });
    }
    if (reconciled.pendingClarify.length > 0) {
      const menu = reconciled.pendingClarify
        .map((p) => `${p.index + 1}. \`${p.leftShort}\` ↔ \`${p.rightShort}\``)
        .join("\n");
      await io.addMessage({
        markdown: `I found several tables that could be reconciled. Reply with the number of the pair:\n\n${menu}`,
        json: { kind: "meta" },
      });
    }
  }

  const ruleReport = renderRuleReport(plan);
  if (ruleReport) {
    rendered = true;
    replyMarkdown = replyMarkdown ? `${replyMarkdown}\n\n${ruleReport}` : ruleReport;
    await io.addMessage({ markdown: ruleReport, json: { kind: "rule-check" } });
  }

  const mutating = plan.steps.some((s) => s.kind === "data" && isMutatingTool(s.tool));

  // Present the turn's result when nothing else already did (no review, no rule
  // report) and the final data step's tool declares its result presentable
  // (`present`) — or the turn performed a write (mutating), whose outcome must be
  // surfaced and verified. A write is relayed even when an earlier show_message
  // already previewed the work, so the confirmation isn't silently dropped.
  if (!opts.reviewShaped && !replyMarkdown && (!rendered || mutating) && finalDataTool && finalDataText != null) {
    if (isPresentableTool(finalDataTool) || mutating) {
      const sourceTool = mutating && lastMutatingTool ? lastMutatingTool : finalDataTool;
      const sourceText = mutating && lastMutatingText != null ? lastMutatingText : finalDataText;
      let markdown: string;
      if (sourceTool === "get_data") markdown = renderGetDataResult(sourceText);
      else if (mutating) markdown = `✓ \`${sourceTool}\` completed:\n\n\`\`\`json\n${sourceText}\n\`\`\``;
      else markdown = sourceText;
      replyMarkdown = markdown;
      await io.addMessage({
        markdown,
        json: { kind: "reply", skills: plan.provenance.skills },
      });
    }
  }

  // ── Verification — LLM checks the reply against the computed evidence ─────
  if (shouldVerify({ reviewShaped: opts.reviewShaped, mutating, hasLlmAuthored: false })) {
    const verdict = await verifyResultLlm({
      databaseId: io.databaseId,
      userId: io.userId,
      rawMessage: opts.rawMessage,
      reply: replyMarkdown,
      toolsUsed,
      evidence,
    });
    if (verdict === null) {
      await io.addMessage({
        markdown: "⚠ Result verification could not run.",
        json: { kind: "verify", unavailable: true },
      });
    } else if (verdictPasses(verdict)) {
      await io.addMessage({
        markdown:
          `✓ Verified — satisfies ${verdict.satisfies.toFixed(2)}, complete ${verdict.complete.toFixed(2)}, ` +
          `accurate ${verdict.accurate.toFixed(2)}, thorough ${verdict.thorough.toFixed(2)}`,
        json: { kind: "verify", ...verdict },
      });
    } else {
      const issues = (verdict.issues ?? []).map((i) => `- ${i}`).join("\n");
      await io.addMessage({
        markdown:
          `⚠ Flagged for review${verdict.reason ? `: ${verdict.reason}` : ""}${issues ? `\n${issues}` : ""}`,
        json: { kind: "verify", ...verdict },
      });
      // Persist the gap so a follow-up can address it.
      try {
        const fresh = await getSession(io.databaseId, io.sessionId);
        if (fresh) {
          await updateSession(io.databaseId, io.sessionId, "metadata", {
            ...(fresh.metadata ?? {}),
            pendingVerify: { rawMessage: opts.rawMessage, reason: verdict.reason, issues: verdict.issues },
          });
        }
      } catch (err: any) {
        console.error("[vers_11] persist pendingVerify failed:", err.message);
      }
    }
  }

  await persistPlan(io, plan, session.parameters);

  const failed = plan.steps
    .filter((s): s is DataStep => s.kind === "data" && !s.ruleCheck && s.status === "error")
    .map((s) => s.tool);
  if (failed.length > 0) {
    await io.addMessage({
      markdown: `⚠ These steps did not complete: ${failed.map((f) => `\`${f}\``).join(", ")}. Reply with a correction or \`retry\`, and I'll re-plan.`,
      json: { kind: "step-failed", tools: failed },
    });
  }

  return { evidence, toolsUsed, paused: false, failed };
}
