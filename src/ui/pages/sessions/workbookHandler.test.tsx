import { test, expect, mock } from "bun:test";

// Mock getSession with one full-workbook message and one legacy preview-only
// message, then exercise the REAL handler.
mock.module("@backend/core/session/sessions/session_all", () => ({
  getSession: async () => ({
    session_id: "s1",
    messages: [
      {
        id: "m1",
        role: "assistant",
        source: "vers_11",
        json: {
          kind: "workbook",
          messageId: "m1",
          contentType: "xlsx",
          workbook: {
            sheets: [
              {
                name: "Budget",
                columns: ["Account", "Amount"],
                rows: [["Revenue", 1000], ["COGS", 400]],
                total: 2,
              },
            ],
          },
        },
      },
      {
        id: "m2",
        role: "assistant",
        source: "vers_11",
        json: {
          kind: "workbook",
          preview: { sheets: [{ name: "Legacy", columns: ["a"], rows: [[1]], total: 1 }] },
        },
      },
    ],
  }),
}));

const { workbookHandler } = await import("./workbookHandler");

function makeCtx(query: Record<string, string>) {
  const captured: { text?: string; html?: string } = {};
  const c = {
    req: { query: (k: string) => query[k] ?? "" },
    get: () => ({ currentDatabaseId: "db1" }),
    text: (content: string, status?: number) => {
      captured.text = content;
      return new Response(content, { status });
    },
    html: (content: string) => {
      captured.html = content;
      return new Response(content);
    },
  } as any;
  return { c, captured };
}

test("renders a full self-contained grid page for a workbook message", async () => {
  const { c, captured } = makeCtx({ session_id: "s1", id: "m1" });

  await workbookHandler(c);

  expect(captured.html).toBeDefined();
  expect(captured.html).toContain("<!DOCTYPE html>");
  expect(captured.html).toContain("<title>Budget</title>");
  expect(captured.html).toContain("Revenue");
  expect(captured.html).toContain("COGS");
  expect(captured.html).toContain("position:sticky");
  expect(captured.html).toContain("rowhead");
});

test("falls back to json.preview.sheets when json.workbook is absent", async () => {
  const { c, captured } = makeCtx({ session_id: "s1", id: "m2" });

  await workbookHandler(c);

  expect(captured.html).toContain("<title>Legacy</title>");
  expect(captured.html).toContain('<td class="num">1</td>');
});

test("404s when the message is not found", async () => {
  const { c, captured } = makeCtx({ session_id: "s1", id: "missing" });

  await workbookHandler(c);

  expect(captured.text).toBe("Message not found");
});

test("400s when params are missing", async () => {
  const { c, captured } = makeCtx({});

  await workbookHandler(c);

  expect(captured.text).toBe("Missing session_id or id query parameter");
});
