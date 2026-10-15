import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { runBuildPipeline } from "@backend/core/process_manager/build-pipeline";
import { getLLMConfigByDatabaseId } from "@backend/core/user/getLLMApiKey";
import type { BuildPlan } from "@backend/core/process_manager/build-pipeline-types";

/**
 * app-wfp-build — plan-driven workflow building as MCP tools.
 *
 * Wraps `runBuildPipeline` (the multi-stage builder) so the chat orchestrator
 * can invoke the reliable plan → approve → build flow through the same MCP
 * channel as every other tool, rather than only through the UI handlers.
 *
 * Two tools, matching the two natural phases of the pipeline:
 *   plan_workflow  → Stage 1 (planner) — one LLM call, produces a BuildPlan.
 *                    No workspace changes are made. The plan is held here,
 *                    keyed by sessionId, awaiting approval.
 *   build_workflow → Stages 2-4 (build tools → wire nodes → integration test).
 *                    Long-running; progress streams to the chat session via
 *                    `runBuildPipeline`'s pushProgress (sessionId-driven).
 *
 * Session discipline: this server never touches workspace/session storage
 * directly. It only (a) reads the scoped databaseId/userId/sessionId, and
 * (b) hands sessionId to the pipeline so its own session messaging drives
 * progress. The pending plan is transient state keyed by sessionId, mirroring
 * the planBuild UI's `pendingPlans` map.
 */

interface BuildContext {
  databaseId: string;
  userId: string;
  sessionId: string;
}

let ctx: BuildContext = { databaseId: "", userId: "", sessionId: "" };

export function setBuildContext(c: Partial<BuildContext>) {
  ctx = { ...ctx, ...c };
}

function requireCtx(): BuildContext {
  if (!ctx.databaseId) throw new Error("No active workspace. Set build context first.");
  return ctx;
}

/** Pending plans awaiting user approval, keyed by chat sessionId. */
const pendingPlans = new Map<string, BuildPlan>();

async function resolveLlmConfig(c: BuildContext) {
  const llmConfig = await getLLMConfigByDatabaseId(c.databaseId, c.userId || undefined);
  return {
    provider: llmConfig.provider,
    model: llmConfig.model,
    apiKey: llmConfig.apiKey,
  };
}

const server = new McpServer({
  name: "app-wfp-build",
  version: "1.0.0",
});

server.registerTool(
  "plan_workflow",
  {
    description: "Plans a new automated workflow from a natural-language description. Produces a structured build plan for user approval. Makes no changes to the workspace.",
    inputSchema: {
      description: z.string().describe("What the workflow should do — inputs, processing, and desired outputs."),
    },
  },
  async ({ description }) => {
    const c = requireCtx();
    const result = await runBuildPipeline({
      userMessage: description,
      databaseId: c.databaseId,
      userId: c.userId,
      llmConfig: await resolveLlmConfig(c),
      sessionId: c.sessionId,
    });

    if (!result.pendingPlan) {
      return { content: [{ type: "text" as const, text: "Planning failed — no plan produced." }], isError: true };
    }

    pendingPlans.set(c.sessionId, result.pendingPlan);
    return { content: [{ type: "text" as const, text: result.text }] };
  },
);

server.registerTool(
  "build_workflow",
  {
    description: "Builds the previously approved workflow plan: creates the custom tools, wires the workflow nodes, and runs an integration test. Only call after the user has approved the plan from plan_workflow.",
  },
  async () => {
    const c = requireCtx();
    const plan = pendingPlans.get(c.sessionId);
    if (!plan) {
      return {
        content: [{ type: "text" as const, text: "No approved plan for this session. Call plan_workflow first, get user approval, then build_workflow." }],
        isError: true,
      };
    }
    pendingPlans.delete(c.sessionId);

    const result = await runBuildPipeline({
      userMessage: "",
      databaseId: c.databaseId,
      userId: c.userId,
      llmConfig: await resolveLlmConfig(c),
      approvedPlan: plan,
      sessionId: c.sessionId,
    });

    // Surface the full build log (including any integration-test error detail)
    // and the workflow id, so the agent can act on the real failure instead of
    // guessing. The log carries the per-stage detail `runBuildPipeline` collects.
    const parts = [result.text];
    if (result.workflowId) {
      parts.push(`workflowId: ${result.workflowId}`);
    }
    if (result.log && result.log.length > 0) {
      parts.push(`\nBuild log:\n${result.log.map((l) => `- ${l}`).join("\n")}`);
    }
    return { content: [{ type: "text" as const, text: parts.join("\n") }] };
  },
);

export async function initBuildServer(transport: Transport) {
  await server.connect(transport);
}
