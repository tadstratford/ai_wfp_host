import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

export const updateWorkflowDetails = async (
  databaseId: string,
  wf_id: string,
  name: string,
  description?: string,
): Promise<boolean> => {
  const session = requireSessionByDatabaseId(databaseId);
  const existing = session.getWorkflow(wf_id);
  if (!existing) return false;

  // If no description provided, keep the existing one (rename-only case)
  let finalDescription = description ?? existing.description ?? "";

  // Preserve existing changelog when the incoming description replaces content
  const changelogHeader = "## Changelog";
  if (
    description != null &&
    existing.description?.includes(changelogHeader) &&
    !description.includes(changelogHeader)
  ) {
    const idx = existing.description.indexOf(changelogHeader);
    const changelogSection = existing.description.slice(idx);
    finalDescription = description.trimEnd() + "\n\n" + changelogSection;
  }

  session.upsertWorkflow({
    ...existing,
    name,
    description: finalDescription,
    updated_at: new Date().toISOString(),
  });
  return true;
};
