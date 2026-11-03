import { test, expect, mock } from "bun:test";

mock.module("@backend/catalog", () => ({
  getCatalogForWorkspace: async () => ({
    skills: [
      {
        name: "report-authoring",
        description: "Author reports",
        scope: "chat+workflow",
        tags: [],
        source: "app",
        tools: [{ name: "chat_download", role: "deliver", description: "Deliver file" }],
      },
      {
        name: "shared-services-allocation",
        description: "Allocate shared services",
        scope: null,
        tags: [],
        source: "workspace",
        tools: [{ name: "get_data", role: null, description: "Read data" }],
      },
    ],
    stories: [],
  }),
}));

const { skillsView } = await import("./skillsPanel");

function ctx(query: Record<string, string> = {}): any {
  let captured = "";
  return {
    get: () => ({ currentDatabaseId: "db1", userId: "u1" }),
    req: { query: (k?: string) => (k === undefined ? query : query[k] ?? null) },
    html: (content: any) => {
      captured = String(content);
      return new Response(captured);
    },
    _captured: () => captured,
  };
}

test("skillsView renders skills → tool pills + user skills + filters", async () => {
  const c = ctx();
  await skillsView(c);
  const captured = c._captured();

  expect(captured).toContain("Skills");
  expect(captured).toContain("report-authoring");
  expect(captured).toContain("chat_download");
  expect(captured).toContain("shared-services-allocation");
  expect(captured).toContain("user");
  expect(captured).toContain("All skills");
  expect(captured).toContain("All tools");
  expect(captured).toContain("New user skill");
});

test("skillsView filters the listing by source", async () => {
  const c = ctx({ source: "app" });
  await skillsView(c);
  const captured = c._captured();

  expect(captured).toContain("Author reports");
  expect(captured).not.toContain("Allocate shared services");
});
