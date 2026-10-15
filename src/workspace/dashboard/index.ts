import { userManager } from "@backend/core/admin/userManager";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
// Experts registry removed — replaced by knowledge packs in V2
// Stubbed types for backward compatibility during migration
type ExpertEntry = { id: string; name: string; description: string; type: "app" | "skill" };
function listAllExperts(_dbId: string): ExpertEntry[] { return []; }
function getSelectedExperts(_dbId: string): string[] { return []; }
function getDefaultSelection(): string[] { return []; }

export interface DashboardContext {
    databaseId: string;
    databaseName: string;
    userPersona: string | null;
    liveStatus: string;
    experts: ExpertEntry[];
    selectedExperts: string[];
}

// ── Live Status Builder ────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
    completed: "✅",
    in_progress: "🔄",
    blocked: "🚫",
    cancelled: "❌",
    skipped: "⏭️",
    pending: "⬜",
    scheduled: "📅",
    waiting_approval: "⏳",
    approved: "✅",
};

async function getLiveStatus(databaseId: string): Promise<string> {
    try {
        const workspace = getSessionByDatabaseId(databaseId);
        if (!workspace) {
            return "No workspace open. Open one from the workspaces page to see live status.";
        }

        const workflowNames = new Map<string, string>();
        for (const w of workspace.getWorkflows()) workflowNames.set(w.id, w.name);

        const sessions = workspace
            .getSessions()
            .slice()
            .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
            .slice(0, 8);

        if (sessions.length === 0) {
            return "No sessions yet. Create a workflow and run a session to get started.";
        }

        const lines: string[] = [];
        for (const s of sessions) {
            const hostExtras = ((s.metadata as any)?.host ?? {}) as Record<string, any>;
            const instanceStatus = (hostExtras.instance_status as string | null) ?? s.status ?? "";
            const icon = STATUS_ICON[instanceStatus] ?? "⬜";
            const workflowName = s.workflow_id ? workflowNames.get(s.workflow_id) ?? "Workflow" : "Workflow";
            const title = `**${workflowName}** — ${s.name ?? s.id}`;
            lines.push(`${icon} ${title}`);

            const progressChatHistory = hostExtras.progress_chat_history as string | undefined;
            if (progressChatHistory) {
                try {
                    const history: Array<{ role: string; content: string }> = JSON.parse(progressChatHistory);
                    const userMsgs = history
                        .filter((m) => m.role === "user")
                        .slice(-3)
                        .map((m) => `    • "${m.content.slice(0, 200)}"`)
                        .join("\n");
                    if (userMsgs) {
                        lines.push(`  Notes:`);
                        lines.push(userMsgs);
                    }
                } catch { /* skip */ }
            }

            lines.push("");
        }

        return lines.join("\n").trimEnd() || "No active workflows.";
    } catch (err) {
        console.error("[Dashboard] getLiveStatus error:", err);
        return "Live status temporarily unavailable.";
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function getDashboardContext(
    userId: string,
    databaseId: string
): Promise<DashboardContext> {
    const userRow = await userManager.getUserContext(userId);

    const experts = listAllExperts(databaseId);
    const savedSelection = getSelectedExperts(databaseId);
    const selectedExperts = savedSelection ?? getDefaultSelection();

    return {
        databaseId,
        databaseName: userRow?.workspace_name ?? "My Workspace",
        userPersona: userRow?.persona_markdown ?? null,
        liveStatus: await getLiveStatus(databaseId),
        experts,
        selectedExperts,
    };
}
