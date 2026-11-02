import { test, expect, mock } from "bun:test";

mock.module("@backend/catalog", () => ({
  getCatalogForWorkspace: async () => ({
    groups: [
      { id: "core", label: "Core", description: "Core skills", alwaysOn: true, defaultOn: false, enabled: true },
      { id: "qbo", label: "QBO", description: "Live QBO", alwaysOn: false, defaultOn: false, enabled: false },
    ],
    skills: [
      {
        name: "report-authoring",
        description: "Author reports",
        scope: "chat+workflow",
        tags: [],
        groupId: "core",
        tools: [{ name: "chat_download", role: "deliver", description: "Deliver file" }],
      },
    ],
    rules: [{ name: "shared-services-allocation", description: "Allocate shared services" }],
    enabledGroupIds: ["core"],
  }),
}));

mock.module("@backend/core/admin/skillGroupsService", () => ({
  saveEnabledSkillGroups: async () => [],
}));

const { skillsView } = await import("./skillsPanel");

function ctx(): any {
  let captured = "";
  return {
    get: () => ({ currentDatabaseId: "db1", userId: "u1" }),
    html: (content: any) => {
      captured = String(content);
      return new Response(captured);
    },
    _captured: () => captured,
  };
}

test("skillsView renders groups → skills → tools + workspace rules", async () => {
  const c = ctx();
  await skillsView(c);
  const captured = c._captured();

  expect(captured).toContain("Skills");
  expect(captured).toContain("Core");
  expect(captured).toContain("report-authoring");
  expect(captured).toContain("chat_download");
  expect(captured).toContain("shared-services-allocation");
  expect(captured).toContain("always on");
});
