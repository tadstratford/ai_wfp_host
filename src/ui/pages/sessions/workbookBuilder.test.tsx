import { test, expect, mock } from "bun:test";

// Mock the workspace store, then exercise the REAL builder handlers against the
// real @data/workbookSheets + @shared/wfp-api/xlsx helpers.
mock.module("@backend/core/workspace/workspaceSessionStore", () => ({
  getSessionByDatabaseId: () => ({
    markActive() {},
    getDataNames: () => ["chat_revenue", "chat_expense", "source_budget"],
    getDataEntry: (name: string) => {
      const entries: Record<string, any> = {
        chat_revenue: {
          content_type: "csv",
          columns: ["Account", "Amount"],
          row_count: 2,
          content: "",
          content_json: [
            { Account: "Revenue", Amount: 1000 },
            { Account: "COGS", Amount: 400 },
          ],
        },
        chat_expense: {
          content_type: "json_array",
          columns: ["Acct"],
          row_count: 1,
          content: "",
          content_json: [{ Acct: "Rent" }],
        },
        source_budget: { content_type: "xlsx", content: "AAAA" },
      };
      return entries[name] ?? null;
    },
  }),
}));

const { workbookBuilderHandler, workbookBuilderDataHandler, workbookBuilderDownloadHandler } =
  await import("./workbookBuilder");

function makeCtx(query: Record<string, string> = {}, body: Record<string, string> = {}) {
  const captured: { html?: string; text?: string; json?: any } = {};
  const c = {
    req: {
      query: (k: string) => query[k] ?? "",
      parseBody: async () => body,
    },
    get: () => ({ currentDatabaseId: "db1" }),
    html: (s: string) => {
      captured.html = s;
      return new Response(s);
    },
    text: (s: string, status?: number) => {
      captured.text = s;
      return new Response(s, { status });
    },
    json: (o: any) => {
      captured.json = o;
      return new Response(JSON.stringify(o));
    },
  } as any;
  return { c, captured };
}

test("builder page lists the workspace's tabular data items", async () => {
  const { c, captured } = makeCtx();
  await workbookBuilderHandler(c);
  expect(captured.html).toContain("Workbook builder");
  expect(captured.html).toContain("chat_revenue");
  expect(captured.html).toContain("chat_expense");
  expect(captured.html).toContain("/public/vendor/jspreadsheet/jspreadsheet.min.js");
  // xlsx source entries are excluded from the checklist.
  expect(captured.html).not.toContain("source_budget");
});

test("data handler returns a jspreadsheet-ready grid for the selection", async () => {
  const { c, captured } = makeCtx({ names: "chat_revenue" });
  await workbookBuilderDataHandler(c);
  expect(captured.json.sheets).toHaveLength(1);
  expect(captured.json.sheets[0]).toEqual({
    name: "chat_revenue",
    columns: ["Account", "Amount"],
    rows: [["Revenue", 1000], ["COGS", 400]],
    total: 2,
  });
});

test("download handler returns a real .xlsx", async () => {
  const { c } = makeCtx({}, { names: "chat_revenue,chat_expense" });
  const res = await workbookBuilderDownloadHandler(c);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
  expect(res.headers.get("Content-Disposition")).toContain("workbook.xlsx");
  const buf = Buffer.from(await res.arrayBuffer());
  expect(buf.length).toBeGreaterThan(0);
  expect(buf.subarray(0, 2).toString()).toBe("PK");
});

test("download handler 400s when nothing is selected", async () => {
  const { c, captured } = makeCtx({}, { names: "" });
  await workbookBuilderDownloadHandler(c);
  expect(captured.text).toBe("No data items selected");
});
