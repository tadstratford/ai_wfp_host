import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { buildFromToolCalls } from "./deterministicBuild";
import {
  openWorkspaceSession,
  getSessionByDatabaseId,
  __resetWorkspaceSessionStore,
} from "@backend/core/workspace/workspaceSessionStore";
import type { WfpFile } from "wfp-format";

function emptyWfp(): WfpFile {
  return {
    metadata: { format_version: "1.0.0", workspace: "Test" },
    workflows: [],
  };
}

describe("buildFromToolCalls (faithful replay)", () => {
  beforeEach(async () => {
    __resetWorkspaceSessionStore();
    await openWorkspaceSession({
      userId: "u1",
      workspaceId: "w1",
      wfp: emptyWfp(),
      secret: null,
      databaseId: "db1",
    });
  });

  afterAll(() => {
    __resetWorkspaceSessionStore();
  });

  it("replays a durable chat_download with a large HTML report faithfully", () => {
    const html = "<!DOCTYPE html><html><body>" + "x".repeat(10000) + "</body></html>";
    const result = buildFromToolCalls("db1", [
      {
        at: "t1",
        tools: [
          {
            tool: "chat_download",
            args: JSON.stringify({ data: html, filename: "report.html" }),
            wf_indicator: true,
          },
        ],
      },
    ]);

    expect(result).not.toBeNull();
    const ws = getSessionByDatabaseId("db1")!;
    const wf = ws.getWorkflow(result!.workflowId);
    expect(wf).not.toBeNull();

    const node = wf!.nodes.find((n) => n.tool_id === "chat_download");
    expect(node).toBeDefined();
    expect((node!.tool_parameters as any).data).toBe(html);
    expect((node!.tool_parameters as any).filename).toBe("report.html");
  });

  it("returns null when there are no durable calls", () => {
    const result = buildFromToolCalls("db1", [
      { at: "t1", tools: [{ tool: "get_data", args: '{"name":"x"}', wf_indicator: false }] },
    ]);
    expect(result).toBeNull();
  });

  it("drops ephemeral reads and keeps only durable steps", () => {
    const result = buildFromToolCalls("db1", [
      {
        at: "t1",
        tools: [
          { tool: "get_data", args: '{"name":"bank"}', wf_indicator: false },
          {
            tool: "save_data",
            args: JSON.stringify({ name: "report", value: "[]", type: "json_array" }),
            wf_indicator: true,
          },
        ],
      },
    ]);

    expect(result).not.toBeNull();
    const ws = getSessionByDatabaseId("db1")!;
    const wf = ws.getWorkflow(result!.workflowId);
    const toolNodes = wf!.nodes.filter((n) => n.type === "tool");
    expect(toolNodes.map((n) => n.tool_id)).toEqual(["save_data", "workflow_audit"]);
  });

  it("keeps a durable aggregate_data producer so save_data's {{result}} resolves", () => {
    const result = buildFromToolCalls("db1", [
      {
        at: "t1",
        tools: [
          {
            tool: "aggregate_data",
            args: JSON.stringify({
              name: "interco_audit_demo_ic_transactions",
              group_by: ["GL Account"],
              measures: [{ column: "Amount (USD)", fn: "sum" }],
            }),
            wf_indicator: true,
          },
          {
            tool: "save_data",
            args: JSON.stringify({ type: "json_array", value: "{{result}}", name: "staging_result" }),
            wf_indicator: true,
          },
        ],
      },
    ]);

    expect(result).not.toBeNull();
    const ws = getSessionByDatabaseId("db1")!;
    const wf = ws.getWorkflow(result!.workflowId);
    const toolNodes = wf!.nodes.filter((n) => n.type === "tool");
    expect(toolNodes.map((n) => n.tool_id)).toEqual(["aggregate_data", "save_data", "workflow_audit"]);
    const saveNode = toolNodes.find((n) => n.tool_id === "save_data");
    expect((saveNode!.tool_parameters as any).value).toBe("{{result}}");
  });

  it("rewires frozen literals: save_data value and chat_download data become {{result}}", () => {
    const result = buildFromToolCalls("db1", [
      {
        at: "t1",
        tools: [
          {
            tool: "aggregate_data",
            args: JSON.stringify({
              name: "interco_audit_demo_ic_transactions",
              group_by: ["GL Account"],
              measures: [{ column: "Amount (USD)", fn: "sum" }],
            }),
            wf_indicator: true,
          },
          {
            tool: "save_data",
            args: JSON.stringify({ type: "json_array", value: "[{\"GL Account\":1200}]", name: "staging_ic_gl_summary" }),
            wf_indicator: true,
          },
          {
            tool: "report_table",
            args: JSON.stringify({
              summary: "staging_ic_gl_summary",
              details: "interco_audit_demo_ic_transactions",
              group_by: ["GL Account"],
              title: "Amount by GL Account",
            }),
            wf_indicator: true,
          },
          {
            tool: "chat_download",
            args: JSON.stringify({ data: "<!DOCTYPE html><html>frozen</html>", filename: "report.html" }),
            wf_indicator: true,
          },
        ],
      },
    ]);

    expect(result).not.toBeNull();
    const ws = getSessionByDatabaseId("db1")!;
    const wf = ws.getWorkflow(result!.workflowId);
    const toolNodes = wf!.nodes.filter((n) => n.type === "tool");
    expect(toolNodes.map((n) => n.tool_id)).toEqual(["aggregate_data", "save_data", "report_table", "chat_download", "workflow_audit"]);

    const saveNode = toolNodes.find((n) => n.tool_id === "save_data");
    expect((saveNode!.tool_parameters as any).value).toBe("{{result}}");

    const download = toolNodes.find((n) => n.tool_id === "chat_download");
    expect((download!.tool_parameters as any).data).toBe("{{result}}");
  });

  it("parameterizes date values into the start node", () => {
    const result = buildFromToolCalls("db1", [
      {
        at: "t1",
        tools: [
          {
            tool: "qbo_actuals_flat",
            args: JSON.stringify({ start_date: "2026-01-01", end_date: "2026-01-31" }),
            wf_indicator: true,
          },
        ],
      },
    ]);

    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ start_date: "2026-01-01", end_date: "2026-01-31" });

    const ws = getSessionByDatabaseId("db1")!;
    const wf = ws.getWorkflow(result!.workflowId);
    const startNode = wf!.nodes.find((n) => n.tool_id === "workflow_start");
    expect((startNode!.tool_parameters as any).start_date).toBe("2026-01-01");
    expect((startNode!.tool_parameters as any).end_date).toBe("2026-01-31");
  });

  it("synthesizes a report tail when a session ends in aggregate_data + judge_data with no deliverable", () => {
    const result = buildFromToolCalls("db1", [
      {
        at: "t1",
        tools: [
          {
            tool: "aggregate_data",
            args: JSON.stringify({
              name: "interco_audit_demo_ic_transactions",
              group_by: ["Status"],
              measures: [
                { column: "Amount (USD)", fn: "sum" },
                { column: "Amount (USD)", fn: "count" },
              ],
            }),
            wf_indicator: true,
          },
          {
            tool: "judge_data",
            args: JSON.stringify({
              name: "interco_audit_demo_ic_transactions",
              kind: "noul",
              instructions: "consistent?",
              columns: ["Txn ID", "Amount (USD)"],
            }),
            wf_indicator: true,
          },
        ],
      },
    ]);

    expect(result).not.toBeNull();
    const ws = getSessionByDatabaseId("db1")!;
    const wf = ws.getWorkflow(result!.workflowId);
    const toolNodes = wf!.nodes.filter((n) => n.type === "tool");
    expect(toolNodes.map((n) => n.tool_id)).toEqual([
      "aggregate_data", "save_data", "judge_data", "report_table", "chat_download", "workflow_audit",
    ]);

    const save = toolNodes.find((n) => n.tool_id === "save_data");
    expect((save!.tool_parameters as any).name).toBe(
      "staging_interco_audit_demo_ic_transactions_summary",
    );
    expect((save!.tool_parameters as any).value).toBe("{{result}}");
    expect((save!.tool_parameters as any).type).toBe("json_array");

    const report = toolNodes.find((n) => n.tool_id === "report_table");
    expect((report!.tool_parameters as any).summary).toBe(
      "staging_interco_audit_demo_ic_transactions_summary",
    );
    expect((report!.tool_parameters as any).details).toBe("interco_audit_demo_ic_transactions");
    expect((report!.tool_parameters as any).group_by).toEqual(["Status"]);

    const download = toolNodes.find((n) => n.tool_id === "chat_download");
    expect((download!.tool_parameters as any).data).toBe("{{result}}");
    expect((download!.tool_parameters as any).filename).toBe("report.html");
  });

  it("synthesizes a flat data-table report for a judge_data-only session", () => {
    const result = buildFromToolCalls("db1", [
      {
        at: "t1",
        tools: [
          {
            tool: "judge_data",
            args: JSON.stringify({
              name: "interco_audit_demo_ic_transactions",
              kind: "noul",
              instructions: "consistent?",
              columns: ["Txn ID", "Amount (USD)"],
            }),
            wf_indicator: true,
          },
        ],
      },
    ]);

    expect(result).not.toBeNull();
    const ws = getSessionByDatabaseId("db1")!;
    const wf = ws.getWorkflow(result!.workflowId);
    const toolNodes = wf!.nodes.filter((n) => n.type === "tool");
    expect(toolNodes.map((n) => n.tool_id)).toEqual(["judge_data", "chat_download", "workflow_audit"]);

    const download = toolNodes.find((n) => n.tool_id === "chat_download");
    expect((download!.tool_parameters as any).widget).toBe("data-table");
    expect((download!.tool_parameters as any).data).toBe("{{result}}");
  });

  it("synthesizes a flat data-table report for a check_data-only session", () => {
    const result = buildFromToolCalls("db1", [
      {
        at: "t1",
        tools: [
          {
            tool: "check_data",
            args: JSON.stringify({
              name: "synth_interco_audit_demo_ic_transactions",
              checks: [{ id: "miscoded_account", question: "Are any transactions miscoded?" }],
            }),
            wf_indicator: true,
          },
        ],
      },
    ]);

    expect(result).not.toBeNull();
    const ws = getSessionByDatabaseId("db1")!;
    const wf = ws.getWorkflow(result!.workflowId);
    const toolNodes = wf!.nodes.filter((n) => n.type === "tool");
    expect(toolNodes.map((n) => n.tool_id)).toEqual(["check_data", "chat_download", "workflow_audit"]);

    const download = toolNodes.find((n) => n.tool_id === "chat_download");
    expect((download!.tool_parameters as any).widget).toBe("data-table");
    expect((download!.tool_parameters as any).data).toBe("{{result}}");
  });

  it("does not synthesize when a session already saved data (no double-report)", () => {
    const result = buildFromToolCalls("db1", [
      {
        at: "t1",
        tools: [
          {
            tool: "aggregate_data",
            args: JSON.stringify({
              name: "bank",
              group_by: ["Account"],
              measures: [{ column: "Amount", fn: "sum" }],
            }),
            wf_indicator: true,
          },
          {
            tool: "save_data",
            args: JSON.stringify({ name: "staging_result", value: "[]", type: "json_array" }),
            wf_indicator: true,
          },
        ],
      },
    ]);

    expect(result).not.toBeNull();
    const ws = getSessionByDatabaseId("db1")!;
    const wf = ws.getWorkflow(result!.workflowId);
    const toolNodes = wf!.nodes.filter((n) => n.type === "tool");
    expect(toolNodes.map((n) => n.tool_id)).toEqual(["aggregate_data", "save_data", "workflow_audit"]);
  });
});
