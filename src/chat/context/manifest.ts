import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { userManager } from "@backend/core/admin/userManager";
import { ensureEnabledSkillGroups } from "@backend/core/admin/skillGroupsService";
import { getToolsList } from "@core/tools/registry";
import { loadAllSkills } from "../../core/skills/loader";
import { loadRules } from "../../rules/loader";

export interface ContextManifest {
  workspaceName: string;
  userPersona: string | null;
  userPreferences: string | null;
  dataFiles: DataFileSummary[];
  workflows: WorkflowSummary[];
  nativeTools: ToolSummary[];
  customTools: ToolSummary[];
  knowledgePacks: KnowledgePackSummary[];
  skills: SkillSummary[];
  rules: RuleSummary[];
  sessions: SessionSummary[];
  connections: Array<{ name: string }>;
  /** Pre-formatted context blocks from ENABLED areas only (module-gated).
   *  Disabled areas contribute nothing — see backend/core/apps/areaQueries.ts. */
  areaContext: string[];
}

interface KnowledgePackSummary {
  name: string;
  scope: string;
  tags: string[];
}

interface SkillSummary {
  name: string;
  scope?: string;
  tags: string[];
  source: "app" | "user";
}

interface RuleSummary {
  name: string;
  tags: string[];
}

interface DataFileSummary {
  name: string;
  sourceFilename: string | null;
  size: number;
  summary: string | null;
  contentType: string | null;
  columns: string | null;    // JSON array of column names
  rowCount: number | null;
}

interface WorkflowSummary {
  workflowId: string;
  name: string;
  summary: string | null;
}

interface ToolSummary {
  toolId: string;
  name: string;
  description: string | null;
  chatRunnable?: boolean;
}

interface SessionSummary {
  sessionId: string;
  workflowName: string | null;
  status: string | null;
  updatedAt: string | null;
  summary: string | null;
}

/**
 * Assemble the lightweight workspace context manifest.
 * Never includes raw file content, full graph JSON, or tool code.
 * Suitable for injection into every LLM prompt.
 *
 * Post-M11e: every read is from the active WorkspaceSession (no SQLite).
 */
export async function buildManifest(
  databaseId: string,
  userId: string,
): Promise<ContextManifest> {
  const session = getSessionByDatabaseId(databaseId);

  // ── User-level data (Supabase) ──────────────────────────────────────────────
  const userRow = await userManager.getUserContext(userId);

  // Split persona into persona body and preferences (## Preferences section)
  const fullPersona = userRow?.persona_markdown ?? null;
  let userPersona: string | null = null;
  let userPreferences: string | null = null;

  if (fullPersona) {
    const prefMatch = fullPersona.match(/^(## Preferences\s[\s\S]*)$/m);
    if (prefMatch) {
      const prefStart = fullPersona.indexOf(prefMatch[1]);
      userPersona = fullPersona.slice(0, prefStart).trim() || null;
      userPreferences = prefMatch[1].trim();
    } else {
      userPersona = fullPersona;
    }
  }

  // Empty defaults — populated below if a session is open.
  let workspaceName = userRow?.workspace_name ?? "My Workspace";
  let dataFiles: DataFileSummary[] = [];
  let workflows: WorkflowSummary[] = [];
  let customTools: ToolSummary[] = [];
  let knowledgePacks: KnowledgePackSummary[] = [];
  let areaContext: string[] = [];

  if (session) {
    workspaceName = session.getWorkspaceName();

    // Context blocks from ENABLED areas only (module-gated). A disabled area —
    // e.g. Accounting (wfp_accounting) when off — contributes zero tokens.
    areaContext = [];

    // Workspace persona removed — WFP workspace rules (wfp.rules[]) are now the
    // workspace's cross-cutting rules/preferences (see loadRules).

    // Data files
    for (const name of session.getDataNames()) {
      const e = session.getDataEntry(name);
      if (!e) continue;
      const contentStr = typeof e.content === "string" ? e.content : "";
      dataFiles.push({
        name,
        sourceFilename: e.source_filename ?? null,
        size: contentStr.length,
        summary: (e as any).summary ?? null,
        contentType: e.content_type ?? null,
        columns: e.columns?.length ? JSON.stringify(e.columns) : null,
        rowCount: e.row_count ?? null,
      });
    }
    dataFiles.sort((a, b) => 0);

    // Workflows
    workflows = session.getWorkflows().map((w) => ({
      workflowId: w.id,
      name: w.name,
      summary: w.summary ?? null,
    }));

    // Custom tools (sorted newest first)
    customTools = session
      .getTools()
      .map((t) => ({
        toolId: t.tool_id,
        name: t.name,
        description: t.description ?? null,
      }));

    // Knowledge packs — names + scope so the builder knows which packs exist
    // and can wire `api.getKnowledge(...)`. Privacy-map packs are never exposed.
    knowledgePacks = session
      .getKnowledgePacks()
      .filter((p) => p.scope !== "privacy-map")
      .map((p) => ({ name: p.name, scope: p.scope, tags: p.tags ?? [] }));
  }

  // Skills — app skills (shipped with code), scoped to the database's enabled
  // groups so the LLM only sees skills the user has switched on.
  let skills: SkillSummary[] = [];
  try {
    await ensureEnabledSkillGroups(databaseId);
    skills = loadAllSkills(undefined, databaseId).map((s) => ({
      name: s.name,
      scope: s.scope,
      tags: s.tags ?? [],
      source: s.source,
    }));
  } catch { /* skills not loaded */ }

  // Rules — workspace-authored rules from wfp.rules[]
  let rules: RuleSummary[] = [];
  try {
    rules = loadRules(databaseId).map((r) => ({
      name: r.name,
      tags: r.tags ?? [],
    }));
  } catch { /* rules not loaded */ }

  // Native tools (from tool registry — runtime, not in .wfp)
  let nativeTools: ToolSummary[] = [];
  try {
    const allTools = await getToolsList(databaseId);
    const { getToolDefinition } = await import("@core/tools/registry");
    nativeTools = await Promise.all(
      allTools
        .filter((t) => !t.isCustom)
        .map(async (t) => {
          const def = await getToolDefinition(t.tool_id);
          return {
            toolId: t.tool_id,
            name: t.name,
            description: t.description,
            chatRunnable: def?.chatRunnable ?? false,
          };
        }),
    );
  } catch { /* registry may not be ready */ }

  // Connections (from Supabase — names only, never values)
  let connections: Array<{ name: string }> = [];
  try {
    connections = await userManager.listSecrets(userId);
  } catch { /* no secrets configured */ }

  // Recent session summaries (last 8) — from the in-session sessions[] array.
  // The runtime "executing workflow session" state still lives in SQLite for
  // now (migrated separately in M11f). The .wfp sessions are the persisted
  // history.
  let sessions: SessionSummary[] = [];
  if (session) {
    const wfNames = new Map<string, string>();
    for (const w of session.getWorkflows()) wfNames.set(w.id, w.name);
    sessions = session
      .getSessions()
      .slice()
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
      .slice(0, 8)
      .map((s) => ({
        sessionId: s.id,
        workflowName: s.workflow_id ? wfNames.get(s.workflow_id) ?? null : null,
        status: s.status ?? null,
        updatedAt: s.updated_at ?? null,
        summary: (s as any).summary ?? null,
      }));
  }

  return {
    workspaceName,
    userPersona,
    userPreferences,
    dataFiles,
    workflows,
    nativeTools,
    customTools,
    knowledgePacks,
    skills,
    rules,
    sessions,
    connections,
    areaContext,
  };
}

/**
 * Format a ContextManifest as a readable string for injection into the system prompt.
 * This is the {{CONTEXT_MANIFEST}} placeholder value.
 */
export function formatManifest(m: ContextManifest): string {
  const lines: string[] = [];

  // Workspace identity
  lines.push(`**Workspace:** ${m.workspaceName}`);

  lines.push("");

  // User
  if (m.userPersona) {
    lines.push("**About the user:**");
    lines.push(m.userPersona);
    lines.push("");
  }

  if (m.userPreferences) {
    lines.push("**User preferences:**");
    lines.push(m.userPreferences);
    lines.push("");
  }

  // Data files — include column names so the builder can generate correct code
  if (m.dataFiles.length > 0) {
    lines.push(`**Data files (${m.dataFiles.length}):**`);
    for (const f of m.dataFiles) {
      const sizeKb = Math.round(f.size / 1024);
      const label = f.sourceFilename ? `${f.name} (${f.sourceFilename})` : f.name;

      const parts: string[] = [];
      if (f.contentType && f.contentType !== "text") {
        parts.push(f.contentType.toUpperCase());
      }
      if (f.rowCount != null) {
        parts.push(`${f.rowCount} rows`);
      }
      if (f.columns) {
        try {
          const cols = JSON.parse(f.columns) as string[];
          if (cols.length > 0) {
            parts.push(`columns: ${cols.join(", ")}`);
          }
        } catch { /* malformed JSON */ }
      }
      if (parts.length === 0) {
        parts.push(f.summary ?? `${sizeKb}KB`);
      }

      lines.push(`- ${label} — ${parts.join(", ")}`);
    }
    lines.push("");
  }

  // Workflows
  if (m.workflows.length > 0) {
    lines.push(`**Workflows (${m.workflows.length}):**`);
    for (const w of m.workflows) {
      const detail = w.summary ?? "No summary yet";
      lines.push(`- [${w.workflowId}] ${w.name} — ${detail}`);
    }
    lines.push("");
  }

  // Native tools
  if (m.nativeTools.length > 0) {
    lines.push(`**Native tools (${m.nativeTools.length}):**`);
    lines.push(
      "Tools marked (chat) can be run directly — ask me to run them. All tools can be used in workflows via workflow.addNode.",
    );
    for (const t of m.nativeTools) {
      const detail = t.description ?? "No description";
      const chatLabel = t.chatRunnable ? " (chat)" : "";
      lines.push(`- [${t.toolId}] ${t.name}${chatLabel} — ${detail}`);
    }
    lines.push("");
  }

  // Custom tools
  if (m.customTools.length > 0) {
    lines.push(`**Custom tools (${m.customTools.length}):**`);
    for (const t of m.customTools) {
      const detail = t.description ?? "No description";
      lines.push(`- [${t.toolId}] ${t.name} — ${detail}`);
    }
    lines.push("");
  }

  // Knowledge packs — names + scope so the builder can wire api.getKnowledge()
  if (m.knowledgePacks.length > 0) {
    lines.push(`**Knowledge packs (${m.knowledgePacks.length}):**`);
    lines.push(
      "Domain knowledge available to this workspace. In tool code, read a pack's " +
        "markdown content at run time with `api.getKnowledge(\"<name>\")`. When a " +
        "workflow's rules live in a pack, load it and follow it instead of hard-coding.",
    );
    for (const p of m.knowledgePacks) {
      const tags = p.tags.length > 0 ? ` [${p.tags.join(", ")}]` : "";
      lines.push(`- **${p.name}** (${p.scope})${tags}`);
    }
    lines.push("");
  }

  // Skills — app-level and user-created instruction sets
  if (m.skills.length > 0) {
    lines.push(`**Skills (${m.skills.length}):**`);
    lines.push(
      "Operational instructions available to guide tool usage and workflows. " +
        "App skills are shipped with the system; user skills are workspace-specific.",
    );
    for (const s of m.skills) {
      const tags = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
      const src = s.source === "app" ? " (app)" : " (user)";
      lines.push(`- **${s.name}** (${s.scope})${tags}${src}`);
    }
    lines.push("");
  }

  // Rules — workspace-authored rules & policies
  if (m.rules.length > 0) {
    lines.push(`**Rules (${m.rules.length}):**`);
    lines.push(
      "Workspace rules and policies authored by the user. Follow these when applicable.",
    );
    for (const r of m.rules) {
      const tags = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
      lines.push(`- **${r.name}**${tags}`);
    }
    lines.push("");
  }

  // Connections (for api.ext.secrets.get() + api.fetch() in tool code)
  if (m.connections.length > 0) {
    lines.push(`**Connections (${m.connections.length}):**`);
    lines.push(
      "Keys available via `await api.ext?.secrets?.get?.(name)` in tool code. Never expose values.",
    );
    for (const c of m.connections) {
      lines.push(`- **${c.name}**`);
    }
    lines.push("");
  }

  // Area context blocks (module-gated) — e.g. Accounting GL dimensions, so
  // generated tool code tags lines with the right labels. Disabled areas
  // contribute nothing.
  for (const block of m.areaContext) {
    lines.push(block);
    lines.push("");
  }

  // Sessions
  if (m.sessions.length > 0) {
    lines.push(`**Recent sessions:**`);
    for (const s of m.sessions) {
      const when = s.updatedAt ? s.updatedAt.slice(0, 10) : "unknown date";
      const wf = s.workflowName ?? "Unknown workflow";
      const status = s.status ?? "unknown";
      const detail = s.summary ?? status;
      lines.push(`- ${wf} (${when}) — ${detail}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
