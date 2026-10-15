import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

/**
 * Append a timestamped changelog entry to the bottom of a workflow's
 * description. Creates the "## Changelog" heading if it doesn't exist yet.
 */
export function appendChangelog(
  databaseId: string,
  workflowId: string,
  note: string,
): void {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) return;

  const now = new Date();
  const timestamp =
    now.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }) +
    " " +
    now.toLocaleTimeString("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  const entry = `- ${timestamp} — ${note}`;

  let desc = wf.description || "";
  const changelogHeader = "## Changelog";
  if (desc.includes(changelogHeader)) {
    desc = desc.replace(changelogHeader, `${changelogHeader}\n${entry}`);
  } else {
    desc = desc.trimEnd() + `\n\n${changelogHeader}\n${entry}`;
  }

  session.upsertWorkflow({
    ...wf,
    description: desc,
    updated_at: new Date().toISOString(),
  });
}
