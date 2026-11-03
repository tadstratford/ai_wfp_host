import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  initSessionsServer,
  setAppHook,
  setSessionDatabaseId,
  setSessionId,
  type AppHook,
} from "./index";
import {
  __resetWorkspaceSessionStore,
  openWorkspaceSession,
} from "@backend/core/workspace/workspaceSessionStore";
import { buildWorkbook } from "@shared/wfp-api/xlsx";
import type { AddMessageArgs } from "@backend/types/chat";
import type { WfpFile } from "wfp-format";
import type { MetaData } from "wfp-api";

// A minimal in-memory AppHook that records delivered messages + params.
function makeHook() {
  const messages: AddMessageArgs[] = [];
  const params = new Map<string, { value: unknown; meta?: MetaData }>();
  const hook: AppHook = {
    addMessage: async (msg: AddMessageArgs) => {
      messages.push(msg);
    },
    setParameter: (name: string, value: unknown, meta?: MetaData) => {
      params.set(name, { value, meta });
    },
    getParameter: (name: string) => params.get(name)?.value,
    getParameterMeta: (name: string) => params.get(name)?.meta,
  };
  return { hook, messages, params };
}

const DB = "test-db";
let client: Client;
let hook: ReturnType<typeof makeHook>;

function wfpWith(data: WfpFile["data"]): WfpFile {
  return { metadata: { format_version: "1.0.0", workspace: "T" }, workflows: [], data };
}

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await initSessionsServer(serverTransport);
  client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  __resetWorkspaceSessionStore();
  hook = makeHook();
  setAppHook(hook.hook);
  setSessionDatabaseId(DB);
  setSessionId("sess-1");
});

afterEach(() => {
  __resetWorkspaceSessionStore();
});

describe("export_workbook", () => {
  test("builds a workbook from tabular data + inline preview", async () => {
    await openWorkspaceSession({
      userId: "u1",
      workspaceId: "w1",
      wfp: wfpWith({
        chat_revenue: {
          content: "Account,Amount\nRevenue,1000",
          content_type: "csv",
          content_json: [
            { Account: "Revenue", Amount: 1000 },
            { Account: "COGS", Amount: 400 },
          ],
          columns: ["Account", "Amount"],
          row_count: 2,
        },
      }),
      secret: null,
      databaseId: DB,
    });

    const res = await client.callTool({ name: "export_workbook", arguments: { include_transcript: false } });
    const text = (res as any).content?.[0]?.text ?? "";
    expect(text).toContain("delivered");

    expect(hook.messages.length).toBe(1);
    const json = hook.messages[0].json as any;
    expect(json.kind).toBe("workbook");
    expect(json.preview.sheets).toHaveLength(1);
    expect(json.preview.sheets[0]).toEqual({
      name: "chat_revenue",
      columns: ["Account", "Amount"],
      rows: [["Revenue", 1000], ["COGS", 400]],
      total: 2,
    });
    // Full (uncapped) data is threaded for the standalone /sessions/workbook tab.
    expect(json.workbook.sheets).toHaveLength(1);
    expect(json.workbook.sheets[0].rows).toEqual([["Revenue", 1000], ["COGS", 400]]);
    // Download button carries a real .xlsx data URI + an open-in-new-tab link.
    expect(hook.messages[0].html).toContain("data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,");
    expect(hook.messages[0].html).toContain("/sessions/workbook?session_id=sess-1");
  });

  test("fails closed on an unknown data name", async () => {
    await openWorkspaceSession({
      userId: "u1",
      workspaceId: "w1",
      wfp: wfpWith({}),
      secret: null,
      databaseId: DB,
    });

    const res = await client.callTool({ name: "export_workbook", arguments: { include_transcript: false, data_names: ["nope"] } });
    const text = (res as any).content?.[0]?.text ?? "";
    expect(text).toContain('Data "nope" not found');
    expect(hook.messages.length).toBe(0);
  });
});

describe("view_workbook", () => {
  test("renders parsed sheets inline with tabs", async () => {
    const buf = buildWorkbook([{ name: "Sheet1", rows: [{ a: 1 }, { a: 2 }] }]);
    const b64 = buf.toString("base64");

    await openWorkspaceSession({
      userId: "u1",
      workspaceId: "w1",
      wfp: wfpWith({
        source_budget: { content: b64, content_type: "xlsx", source_filename: "budget.xlsx", row_count: 1 },
        budget_sheet1: { content: "a\n1\n2", content_type: "csv", content_json: [{ a: 1 }, { a: 2 }], columns: ["a"], row_count: 2 },
      }),
      secret: null,
      databaseId: DB,
    });

    const res = await client.callTool({ name: "view_workbook", arguments: { name: "budget" } });
    const text = (res as any).content?.[0]?.text ?? "";
    expect(text).toContain("rendered inline");

    const json = hook.messages[0].json as any;
    expect(json.kind).toBe("workbook");
    expect(json.preview.sheets).toHaveLength(1);
    expect(json.preview.sheets[0].name).toBe("Sheet1");
    expect(json.preview.sheets[0].columns).toEqual(["a"]);
    expect(json.workbook.sheets[0].rows).toEqual([[1], [2]]);
    expect(hook.messages[0].html).toContain("Download original");
    expect(hook.messages[0].html).toContain("Open in new tab");
    expect(hook.messages[0].html).toContain("/sessions/workbook?session_id=sess-1");
  });

  test("fails closed when the workbook was not uploaded", async () => {
    await openWorkspaceSession({ userId: "u1", workspaceId: "w1", wfp: wfpWith({}), secret: null, databaseId: DB });
    const res = await client.callTool({ name: "view_workbook", arguments: { name: "budget" } });
    const text = (res as any).content?.[0]?.text ?? "";
    expect(text).toContain("not found");
    expect(hook.messages.length).toBe(0);
  });
});

describe("chat_download (xlsx)", () => {
  test("serializes a stored json_array to a one-sheet workbook", async () => {
    await openWorkspaceSession({ userId: "u1", workspaceId: "w1", wfp: wfpWith({}), secret: null, databaseId: DB });

    await client.callTool({
      name: "set_param",
      arguments: { name: "mytable", value: JSON.stringify([{ x: 1 }, { x: 2 }]), type: "json_array" },
    });
    const res = await client.callTool({
      name: "chat_download",
      arguments: { param: "mytable", content_type: "xlsx" },
    });
    const text = (res as any).content?.[0]?.text ?? "";
    expect(text).toContain("delivered");

    const json = hook.messages[0].json as any;
    expect(json.kind).toBe("workbook");
    expect(json.preview.sheets).toHaveLength(1);
    expect(json.preview.sheets[0].name).toBe("mytable");
  });
});

describe("build_workbook", () => {
  test("emits an open-workbook-builder link (with pre-selection)", async () => {
    const res = await client.callTool({
      name: "build_workbook",
      arguments: { data_names: ["chat_revenue", "chat_expense"] },
    });
    const text = (res as any).content?.[0]?.text ?? "";
    expect(text).toContain("builder");

    expect(hook.messages.length).toBe(1);
    expect(hook.messages[0].json).toMatchObject({ kind: "workbook-builder" });
    expect(hook.messages[0].html).toContain("/sessions/workbook-builder?names=");
    expect(hook.messages[0].html).toContain("chat_revenue%2Cchat_expense");
  });

  test("emits a plain link when no pre-selection is given", async () => {
    const res = await client.callTool({ name: "build_workbook", arguments: {} });
    expect((res as any).content?.[0]?.text).toContain("builder");
    expect(hook.messages[0].html).toContain('href="/sessions/workbook-builder"');
  });
});
