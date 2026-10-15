import { Context } from "hono";
import type { User } from "@backend/types";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { getLLMConfigByDatabaseId } from "@backend/core/user/getLLMApiKey";
import { callLLM } from "@backend/core/llm/llm-client";
import { loadPrompt } from "@chat/prompts/loader";
import { markdownToHtml } from "@backend/utilities/markdownToHtml";
import { getToolsList } from "@core/tools/registry";
import { loadRules } from "@rules/loader";
import { Stepper, WizIcon, FIELD_HEAD, ErrCard } from "./wizardPage";

/**
 * Modify Workflow — full-page 3-step wizard, mirroring the Make Workflow wizard.
 *
 *   1. Describe — a live-draft interview: the AI asks what to change and a
 *                 "Changes so far" panel grows on the right.
 *   2. Review   — a structured modification plan (updated description + node
 *                 changes: add / update / delete / reorder).
 *   3. Apply    — the plan is written deterministically via ws.upsertWorkflow.
 *
 * Modify reuses existing tools only — it never generates new custom-tool code.
 */

const MODIFY_STEPS = ["Describe", "Review", "Apply"];

interface ModifyDraft {
  summary: string;
  descriptionNotes: string;
  stepNotes: string;
}

type NodeChange =
  | { action: "add"; label: string; tool_id: string; tool_parameters?: Record<string, unknown>; after_node_id?: string }
  | { action: "update"; node_id: string; label?: string; tool_parameters?: Record<string, unknown> }
  | { action: "delete"; node_id: string }
  | { action: "reorder"; node_ids: string[] };

interface ModifyPlan {
  name: string;
  description: string;
  nodeChanges: NodeChange[];
}

interface ModifyState {
  workflowId: string;
  workflowName: string;
  workflow: any;
  qa: { q: string; a: string }[];
  current: { q: string; hint: string } | null;
  draft: ModifyDraft;
  done: boolean;
  plan: ModifyPlan | null;
  llmConfig: { provider: string; model: string; apiKey?: string };
  databaseId: string;
  userId: string;
}

const modifyInterviews = new Map<string, ModifyState>();

function formatWorkflowSummary(wf: any): string {
  const nodes = [...(wf.nodes ?? [])]
    .sort((a: any, b: any) => (a.step_order ?? 0) - (b.step_order ?? 0))
    .map((n: any) => `- ${n.label || "Untitled step"} (${n.tool_id})`);
  return [
    `Name: ${wf.name}`,
    wf.description ? `Description:\n${wf.description}` : "Description: (none)",
    `Steps:\n${nodes.length ? nodes.join("\n") : "(none)"}`,
  ].join("\n\n");
}

async function askModifyInterviewer(
  state: ModifyState,
  extraAnswer?: string,
): Promise<{ question: string; hint: string; done: boolean; draft: ModifyDraft }> {
  const conversationLines = state.qa.map(
    (p) => `- You asked: "${p.q}"\n- They answered: "${p.a}"`,
  );
  if (extraAnswer != null) {
    conversationLines.push(`- They answered: "${extraAnswer}"`);
  }
  const conversation = conversationLines.length
    ? conversationLines.join("\n")
    : "No questions asked yet — ask the opening question.";

  const systemPrompt = loadPrompt("pipeline/modify-interviewer", {
    WORKFLOW: formatWorkflowSummary(state.workflow),
    CONVERSATION: conversation,
    DRAFT: JSON.stringify(state.draft, null, 2),
  });

  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const p of state.qa) {
    messages.push({ role: "assistant", content: p.q });
    messages.push({ role: "user", content: p.a });
  }
  if (extraAnswer != null) messages.push({ role: "user", content: extraAnswer });

  const result = await callLLM(state.llmConfig, {
    systemPrompt,
    messages,
    responseFormat: "json",
    temperature: 0.4,
    maxTokens: 1024,
  });

  const d = result.data ?? {};
  const draft: ModifyDraft = {
    summary: typeof d.draft?.summary === "string" ? d.draft.summary : state.draft.summary,
    descriptionNotes: typeof d.draft?.descriptionNotes === "string" ? d.draft.descriptionNotes : state.draft.descriptionNotes,
    stepNotes: typeof d.draft?.stepNotes === "string" ? d.draft.stepNotes : state.draft.stepNotes,
  };

  return {
    question: typeof d.question === "string" ? d.question : "",
    hint: typeof d.hint === "string" ? d.hint : "",
    done: !!d.done,
    draft,
  };
}

// ── Step 1 — Describe (intro + interview) ────────────────────────────────────

export const modifyWizardView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const workflowId = c.req.param("workflowId");

  const ws = databaseId ? getSessionByDatabaseId(databaseId) : null;
  const workflow = ws?.getWorkflow(workflowId);
  if (!workflow) {
    return c.html(<ErrCard message="Workflow not found." startOverHref="/app/overview" />);
  }

  const nodes = [...(workflow.nodes ?? [])].sort(
    (a: any, b: any) => (a.step_order ?? 0) - (b.step_order ?? 0),
  );

  return c.html(
    <div class="max-w-2xl mx-auto px-4 py-6 md:py-8">
      {Stepper(1, MODIFY_STEPS)}
      <div class="card p-6 md:p-8">
        <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">What would you like to change?</h1>
        <p class="text-sm text-ink-500 mt-1">
          You're modifying <b>{workflow.name}</b> ({nodes.length} steps). The AI will ask a few questions, then you'll review the change before it's applied.
        </p>

        <form hx-post={`/app/modify-workflow/${workflowId}/start`} hx-target="#main-panel" hx-swap="innerHTML" class="mt-6">
          <button type="submit" class="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-400 transition">
            Describe changes <WizIcon name="arrowright" size={15} />
          </button>
        </form>
      </div>
    </div>,
  );
};

function ModifyThread(state: ModifyState) {
  return (
    <>
      {state.qa.map((p) => (
        <>
          <div class="flex items-start gap-2">
            <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-500 dark:bg-brand-900/40 dark:text-brand-300 p-1">
              <WizIcon name="sparkle" size={12} />
            </span>
            <div class="rounded-xl bg-ink/[0.05] px-3 py-2 text-sm text-ink-700 dark:bg-white/[0.06] dark:text-white/80">{p.q}</div>
          </div>
          <div class="flex justify-end">
            <div class="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{p.a}</div>
          </div>
        </>
      ))}
      {state.current && (
        <div class="flex items-start gap-2">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-500 dark:bg-brand-900/40 dark:text-brand-300 p-1">
            <WizIcon name="sparkle" size={12} />
          </span>
          <div class="rounded-xl bg-ink/[0.05] px-3 py-2 text-sm text-ink-700 dark:bg-white/[0.06] dark:text-white/80">{state.current.q}</div>
        </div>
      )}
      {state.done && !state.current && (
        <div class="flex items-start gap-2">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-leaf-50 text-leaf-600 dark:bg-leaf-900/40 dark:text-leaf-300 p-1">
            <WizIcon name="check" size={12} />
          </span>
          <div class="text-sm text-leaf-700 dark:text-leaf-300">Good — I have enough. Press <b>Continue</b> to review.</div>
        </div>
      )}
    </>
  );
}

function ModifyDraftPanel(draft: ModifyDraft) {
  const hasDraft = draft.summary || draft.descriptionNotes || draft.stepNotes;
  return (
    <div class="rounded-xl border border-ink/[0.08] bg-[#F3F5F9] dark:bg-ink-800 dark:border-white/[0.08] p-4 h-fit">
      <div class="flex items-center justify-between mb-3">
        <span class={FIELD_HEAD}>Changes so far</span>
        <span class="pill bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
          <WizIcon name="sparkle" size={11} /> live
        </span>
      </div>
      {!hasDraft ? (
        <div class="text-ink-400 italic">Nothing yet — answer a question to start.</div>
      ) : (
        <div class="space-y-3 text-sm">
          {draft.summary && (
            <div>
              <div class={FIELD_HEAD}>Summary</div>
              <div class="text-ink-700 dark:text-white/80">{draft.summary}</div>
            </div>
          )}
          {draft.descriptionNotes && (
            <div>
              <div class={FIELD_HEAD}>Description changes</div>
              <div class="text-ink-700 dark:text-white/80">{draft.descriptionNotes}</div>
            </div>
          )}
          {draft.stepNotes && (
            <div>
              <div class={FIELD_HEAD}>Step changes</div>
              <div class="text-ink-700 dark:text-white/80">{draft.stepNotes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModifyInterviewView(id: string, state: ModifyState) {
  const placeholder = state.current
    ? state.current.hint || "Your answer…"
    : state.done
      ? "Add anything else, or press Continue"
      : "Your answer…";

  return (
    <div class="max-w-3xl mx-auto px-4 py-6 md:py-8">
      {Stepper(1, MODIFY_STEPS)}
      <div class="card p-6 md:p-8">
        <div class="flex items-center gap-2 mb-2">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-900/40 dark:text-brand-300 p-1.5">
            <WizIcon name="sparkle" size={16} />
          </span>
          <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">Describe your changes to {state.workflowName}</h1>
        </div>
        <p class="text-sm text-ink-500">
          I'll ask a few questions. Answer in your own words — watch the change notes build as you go. Press{" "}
          <span class="font-semibold text-ink-700 dark:text-white/80">Continue</span> whenever it's good enough.
        </p>

        <div class="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 mt-5">
          <div>
            <div class="space-y-3">{ModifyThread(state)}</div>
            <form
              hx-post="/app/modify-workflow/interview"
              hx-target="#main-panel"
              hx-swap="innerHTML"
              class="mt-3"
            >
              <input type="hidden" name="interviewId" value={id} />
              <div class="flex items-center gap-2">
                <input
                  name="answer"
                  type="text"
                  autofocus
                  placeholder={placeholder}
                  class="flex-1 rounded-xl border border-ink/[0.12] bg-[#F3F5F9] px-3 py-2 text-sm text-ink dark:bg-ink-800 dark:border-white/[0.1] dark:text-white placeholder:text-ink-400 outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:focus:bg-ink-900 dark:focus:ring-brand-900 transition"
                />
                <button type="submit" aria-label="Send" class="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white hover:bg-brand-400 transition">
                  <WizIcon name="arrowright" size={16} />
                </button>
              </div>
              <div class="htmx-indicator flex items-center gap-2 text-xs text-ink-400 mt-2">
                <div class="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-brand-500"></div>
                Asking…
              </div>
            </form>
            <div class="mt-2 text-xs text-ink-400">The AI asks; you answer. Your answers fill the change notes on the right.</div>
          </div>

          {ModifyDraftPanel(state.draft)}
        </div>

        <div class="flex items-center justify-between mt-6">
          <a
            hx-get={`/app/modify-workflow/${state.workflowId}`}
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-1.5 rounded-xl border border-ink/[0.1] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 no-underline"
          >
            <WizIcon name="back" size={15} /> Back
          </a>
          <form hx-post="/app/modify-workflow/interview/finalize" hx-target="#main-panel" hx-swap="innerHTML">
            <input type="hidden" name="interviewId" value={id} />
            <button type="submit" class="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-400 transition">
              Continue <WizIcon name="arrowright" size={15} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Interview handlers ───────────────────────────────────────────────────────

const modifyStartHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const workflowId = c.req.param("workflowId");
  if (!databaseId) {
    return c.html(<ErrCard message="No workspace active." startOverHref="/app/overview" />);
  }
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) {
    return c.html(<ErrCard message="No workspace session." startOverHref="/app/overview" />);
  }
  const workflow = ws.getWorkflow(workflowId);
  if (!workflow) {
    return c.html(<ErrCard message="Workflow not found." startOverHref="/app/overview" />);
  }

  const llmConfig = await getLLMConfigByDatabaseId(databaseId, user.userId);

  const state: ModifyState = {
    workflowId,
    workflowName: workflow.name,
    workflow,
    qa: [],
    current: null,
    draft: { summary: "", descriptionNotes: "", stepNotes: "" },
    done: false,
    plan: null,
    llmConfig: { provider: llmConfig.provider, model: llmConfig.model, apiKey: llmConfig.apiKey },
    databaseId,
    userId: user.userId,
  };

  const id = crypto.randomUUID();

  try {
    const next = await askModifyInterviewer(state);
    state.draft = next.draft;
    state.done = next.done;
    if (next.question) state.current = { q: next.question, hint: next.hint };
  } catch (err: any) {
    return c.html(<ErrCard message={`Couldn't start the interview: ${err.message || String(err)}`} startOverHref={`/app/modify-workflow/${workflowId}`} />);
  }

  modifyInterviews.set(id, state);
  return c.html(ModifyInterviewView(id, state));
};

const modifyInterviewStep = async (c: Context) => {
  const body = await c.req.parseBody();
  const id = ((body.interviewId as string) || "").trim();
  const state = modifyInterviews.get(id);
  if (!state) {
    return c.html(<ErrCard message="This interview expired — please start again." startOverHref="/app/overview" />);
  }

  const answer = ((body.answer as string) || "").trim();
  if (!answer) {
    return c.html(ModifyInterviewView(id, state));
  }

  try {
    if (state.current) {
      state.qa.push({ q: state.current.q, a: answer });
      state.current = null;
      const next = await askModifyInterviewer(state);
      state.draft = next.draft;
      state.done = next.done;
      if (next.question) state.current = { q: next.question, hint: next.hint };
    } else {
      const next = await askModifyInterviewer(state, answer);
      state.draft = next.draft;
      state.done = next.done;
      if (next.question) state.current = { q: next.question, hint: next.hint };
    }
  } catch (err: any) {
    return c.html(<ErrCard message={`Interview failed: ${err.message || String(err)}`} startOverHref={`/app/modify-workflow/${state.workflowId}`} />);
  }

  return c.html(ModifyInterviewView(id, state));
};

// ── Step 2 — Review ──────────────────────────────────────────────────────────

async function buildModifyPlan(state: ModifyState): Promise<ModifyPlan> {
  const tools = await getToolsList(state.databaseId);
  const toolsSection = tools.length
    ? tools.map((t) => `- ${t.tool_id} — ${t.name}${t.description ? `: ${t.description}` : ""}`).join("\n")
    : "No tools available.";

  const rules = loadRules(state.databaseId);
  const rulesSection = rules.length
    ? rules.map((s) => `### ${s.name}\n${s.content}`).join("\n\n")
    : "No workspace rules.";

  const ws = getSessionByDatabaseId(state.databaseId);
  const packs = (ws?.getKnowledgePacks() ?? []).filter((p) => p.scope !== "privacy-map");
  const knowledgeSection = packs.length
    ? packs.map((p) => `- ${p.name} (${p.scope})`).join("\n")
    : "No knowledge packs.";

  const changesText = [
    state.draft.summary ? `Summary: ${state.draft.summary}` : "",
    state.draft.descriptionNotes ? `Description changes:\n${state.draft.descriptionNotes}` : "",
    state.draft.stepNotes ? `Step changes:\n${state.draft.stepNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = loadPrompt("pipeline/modify-planner", {
    WORKFLOW: JSON.stringify(state.workflow, null, 2),
    TOOLS: toolsSection,
    SKILLS: rulesSection,
    KNOWLEDGE_PACKS: knowledgeSection,
    CHANGES: changesText,
  });

  const result = await callLLM(state.llmConfig, {
    systemPrompt,
    messages: [{ role: "user", content: changesText }],
    responseFormat: "json",
    temperature: 0.3,
    maxTokens: 4096,
  });

  const d = result.data ?? {};
  return {
    name: typeof d.name === "string" && d.name ? d.name : state.workflow.name,
    description: typeof d.description === "string" ? d.description : state.workflow.description || "",
    nodeChanges: Array.isArray(d.nodeChanges) ? d.nodeChanges : [],
  };
}

const finalizeModifyInterview = async (c: Context) => {
  const body = await c.req.parseBody();
  const id = ((body.interviewId as string) || "").trim();
  const state = modifyInterviews.get(id);
  if (!state) {
    return c.html(<ErrCard message="This interview expired — please start again." startOverHref="/app/overview" />);
  }

  try {
    state.plan = await buildModifyPlan(state);
  } catch (err: any) {
    return c.html(<ErrCard message={`Planning failed: ${err.message || String(err)}`} startOverHref={`/app/modify-workflow/${state.workflowId}`} />);
  }

  return c.html(ModifyReviewView(id, state));
};

const CHANGE_BADGE: Record<string, string> = {
  add: "bg-leaf-50 text-leaf-600 dark:bg-leaf-900/40 dark:text-leaf-300",
  update: "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300",
  delete: "bg-coral-50 text-coral-600 dark:bg-coral-900/40 dark:text-coral-300",
  reorder: "bg-grape-50 text-grape-500 dark:bg-grape-900/40 dark:text-grape-300",
};

function ModifyReviewView(id: string, state: ModifyState) {
  const plan = state.plan!;

  return (
    <div class="max-w-2xl mx-auto px-4 py-6 md:py-8">
      {Stepper(2, MODIFY_STEPS)}
      <div class="card p-6 md:p-8">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">{plan.name}</h1>
          <span class="pill bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <WizIcon name="sparkle" size={13} /> drafted by AI
          </span>
        </div>
        <p class="text-sm text-ink-500 mb-5">This is the proposed change. Nothing has been applied yet. Approve it, or go back and adjust.</p>

        {plan.nodeChanges.length > 0 && (
          <div class="mb-4">
            <div class={FIELD_HEAD + " mb-2"}>Step changes</div>
            <ul class="space-y-2">
              {plan.nodeChanges.map((ch, i) => {
                const badge = CHANGE_BADGE[ch.action] || CHANGE_BADGE.update;
                if (ch.action === "add") {
                  return (
                    <li class="flex items-center gap-2 text-sm text-ink-700 dark:text-white/80">
                      <span class={`pill ${badge}`}>add</span>
                      <span><b>{ch.label}</b> <span class="text-ink-400 font-mono text-xs">({ch.tool_id})</span></span>
                    </li>
                  );
                }
                if (ch.action === "update") {
                  return (
                    <li class="flex items-center gap-2 text-sm text-ink-700 dark:text-white/80">
                      <span class={`pill ${badge}`}>update</span>
                      <span class="font-mono text-xs text-ink-400">{ch.node_id}</span>
                      {ch.label ? <span>→ <b>{ch.label}</b></span> : <span>parameters</span>}
                    </li>
                  );
                }
                if (ch.action === "delete") {
                  return (
                    <li class="flex items-center gap-2 text-sm text-ink-700 dark:text-white/80">
                      <span class={`pill ${badge}`}>remove</span>
                      <span class="font-mono text-xs text-ink-400">{ch.node_id}</span>
                    </li>
                  );
                }
                return (
                  <li class="flex items-center gap-2 text-sm text-ink-700 dark:text-white/80">
                    <span class={`pill ${badge}`}>reorder</span>
                    <span class="font-mono text-xs text-ink-400">{ch.node_ids.join(" → ")}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div class={FIELD_HEAD + " mb-2"}>Updated description</div>
        <div
          class="prose dark:prose-invert prose-sm max-w-none max-h-[46vh] overflow-y-auto bg-[#F3F5F9] dark:bg-ink-800 rounded-lg p-4"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(plan.description) }}
        />

        <form
          hx-post="/app/modify-workflow/apply"
          hx-target="#main-panel"
          hx-swap="innerHTML"
          class="flex items-center justify-end gap-2 mt-5"
        >
          <input type="hidden" name="interviewId" value={id} />
          <a
            hx-get={`/app/modify-workflow/${state.workflowId}`}
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-ink-600 dark:text-white/80 bg-ink/[0.05] dark:bg-white/[0.06] hover:bg-ink/[0.08] rounded-xl no-underline"
          >
            Back
          </a>
          <button class="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-400 rounded-xl">
            Apply changes <WizIcon name="check" size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Step 3 — Apply ───────────────────────────────────────────────────────────

function applyModifyPlan(ws: any, workflowId: string, plan: ModifyPlan): void {
  const wf = ws.getWorkflow(workflowId);
  if (!wf) throw new Error(`Workflow ${workflowId} not found`);

  let nodes: any[] = [...(wf.nodes ?? [])];

  for (const change of plan.nodeChanges) {
    if (change.action === "add") {
      const afterIdx = change.after_node_id
        ? nodes.findIndex((n) => n.id === change.after_node_id)
        : -1;
      const insertAt = afterIdx >= 0 ? afterIdx + 1 : nodes.length;
      const nodeId = `node-${Math.random().toString(36).slice(2, 8)}`;
      nodes.splice(insertAt, 0, {
        id: nodeId,
        type: "tool",
        label: change.label,
        tool_id: change.tool_id,
        tool_parameters: change.tool_parameters || {},
      });
    } else if (change.action === "update") {
      const idx = nodes.findIndex((n) => n.id === change.node_id);
      if (idx >= 0) {
        if (change.label !== undefined) nodes[idx] = { ...nodes[idx], label: change.label };
        if (change.tool_parameters !== undefined) nodes[idx] = { ...nodes[idx], tool_parameters: change.tool_parameters };
      }
    } else if (change.action === "delete") {
      nodes = nodes.filter((n) => n.id !== change.node_id);
    } else if (change.action === "reorder") {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const listed = new Set(change.node_ids);
      const reordered = change.node_ids.map((id) => byId.get(id)).filter(Boolean);
      const rest = nodes.filter((n) => !listed.has(n.id));
      nodes = [...reordered, ...rest];
    }
  }

  nodes = nodes.map((n, i) => ({ ...n, step_order: i + 1 }));

  // Enforce a terminal workflow_audit node (fail-closed), like the builder.
  if (!nodes.some((n) => n.tool_id === "workflow_audit")) {
    const endIdx = nodes.findIndex((n) => n.tool_id === "workflow_end");
    const insertAt = endIdx >= 0 ? endIdx : nodes.length;
    nodes.splice(insertAt, 0, {
      id: `node-${Math.random().toString(36).slice(2, 8)}`,
      type: "tool",
      label: "Audit Workflow",
      tool_id: "workflow_audit",
      tool_parameters: {},
    });
    nodes = nodes.map((n, i) => ({ ...n, step_order: i + 1 }));
  }

  ws.upsertWorkflow({
    ...wf,
    name: plan.name || wf.name,
    description: plan.description,
    nodes,
    updated_at: new Date().toISOString(),
  });
}
const modifyApplyHandler = async (c: Context) => {
  const body = await c.req.parseBody();
  const id = ((body.interviewId as string) || "").trim();
  const state = modifyInterviews.get(id);
  if (!state || !state.plan) {
    return c.html(<ErrCard message="Plan expired — please start again." startOverHref="/app/overview" />);
  }
  modifyInterviews.delete(id);

  const ws = getSessionByDatabaseId(state.databaseId);
  if (!ws) {
    return c.html(<ErrCard message="No workspace session." startOverHref="/app/overview" />);
  }

  try {
    applyModifyPlan(ws, state.workflowId, state.plan);
  } catch (err: any) {
    return c.html(<ErrCard message={`Apply failed: ${err.message || String(err)}`} startOverHref={`/app/modify-workflow/${state.workflowId}`} />);
  }

  return c.html(
    <div class="max-w-2xl mx-auto px-4 py-6 md:py-8">
      {Stepper(3, MODIFY_STEPS)}
      <div class="card p-6 md:p-8">
        <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">Workflow updated</h1>
        <p class="text-sm text-ink-500 mt-1">Your changes were applied.</p>

        <div class="mt-6 rounded-xl border border-leaf-200 bg-leaf-50/60 dark:border-leaf-800 dark:bg-leaf-900/20 p-4 flex items-start gap-3">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-leaf-500 text-white p-1.5">
            <WizIcon name="check" size={16} />
          </span>
          <div>
            <div class="text-sm font-semibold text-leaf-700 dark:text-leaf-300">Done.</div>
            <div class="text-xs text-leaf-600 dark:text-leaf-300/80 mt-0.5">The workflow is updated and ready to run.</div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 mt-5">
          <a
            hx-get="/app/overview"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="px-4 py-2 text-sm font-semibold text-ink-600 dark:text-white/80 bg-ink/[0.05] dark:bg-white/[0.06] hover:bg-ink/[0.08] rounded-xl no-underline"
          >
            Done
          </a>
          <a
            hx-get={`/app/view/${state.workflowId}`}
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-400 rounded-xl no-underline"
          >
            <WizIcon name="play" size={14} /> View workflow
          </a>
        </div>
      </div>
    </div>,
  );
};

export { modifyStartHandler, modifyInterviewStep, finalizeModifyInterview, modifyApplyHandler };
