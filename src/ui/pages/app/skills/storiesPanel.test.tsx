import { test, expect, mock } from "bun:test";

mock.module("@backend/catalog", () => ({
  getCatalogForWorkspace: async () => ({
    groups: [{ id: "core", label: "Core", description: "Core skills", alwaysOn: true, defaultOn: false, enabled: true }],
    skills: [],
    stories: [
      {
        name: "audit-review",
        description: "The accountant's arc",
        nouls: {},
        source: "app",
        beats: [
          {
            storyName: "audit-review",
            beatId: "execute",
            sortOrder: 0,
            skills: ["report-authoring"],
            template: "journal",
            verify: "balanced",
            write: true,
          },
        ],
      },
      {
        name: "my-close",
        description: "My custom close",
        nouls: {},
        source: "workspace",
        beats: [
          {
            storyName: "my-close",
            beatId: "setup",
            sortOrder: 0,
            skills: ["shared-services-allocation"],
            template: "map",
            verify: "accurate",
          },
        ],
      },
    ],
    enabledGroupIds: ["core"],
  }),
}));

const { storiesView } = await import("./storiesPanel");

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

test("storiesView renders stories → beats → skills", async () => {
  const c = ctx();
  await storiesView(c);
  const captured = c._captured();

  expect(captured).toContain("Stories");
  expect(captured).toContain("audit-review");
  expect(captured).toContain("execute");
  expect(captured).toContain("report-authoring");
  expect(captured).toContain("my-close");
  expect(captured).toContain("shared-services-allocation");
  expect(captured).toContain("workspace");
  expect(captured).toContain("New story");
});

test("storiesView filters by skill", async () => {
  const c = ctx({ skill: "shared-services-allocation" });
  await storiesView(c);
  const captured = c._captured();

  expect(captured).toContain("my-close");
  expect(captured).toContain("<code>shared-services-allocation</code>");
  expect(captured).not.toContain("<code>report-authoring</code>");
});
