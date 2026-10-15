import { Context } from "hono";
import type { User } from "@backend/types";
import { runBuildPipeline, getBuildProgress } from "@backend/core/process_manager/build-pipeline";
import { startBuild, getBuild } from "@backend/core/process_manager/buildRunner";
import { getLLMConfigByDatabaseId } from "@backend/core/user/getLLMApiKey";
import { callLLM } from "@backend/core/llm/llm-client";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { loadPrompt } from "@chat/prompts/loader";
import { markdownToHtml } from "@backend/utilities/markdownToHtml";
import { createSession } from "@backend/core/session/sessions/session_all";
import { ENTRY_POINTS } from "../../../components/workflowModal";

/**
 * Make Workflow — full-page 4-step wizard, styled to MOCKUP_V5/make_workflow.html.
 *
 *   1. Choose   — a starting point (accounting-shaped cards) or from scratch.
 *   2. Describe — a live-draft interview: the AI asks one question at a time and
 *                 a "Draft so far" panel grows on the right.
 *   3. Review   — the drafted plan (planner stage of runBuildPipeline).
 *   4. Build    — the built workflow, ready to view/run.
 *
 * Every starting point (template, from-scratch, email) routes through the
 * interview. "Continue" finalizes the interview into the plan-first pipeline —
 * the same engine the modal flow uses.
 */

const pendingPlans = new Map<string, { plan: unknown; params: Record<string, unknown>; steps: string[] }>();

/** Stepper steps per buildId, so the polling result view renders the right step count. */
const buildSteps = new Map<string, string[]>();

// ── Icons (Lucide-style single-path glyphs, viewBox 0 0 24 24) ───────────────

const WIZ_ICONS: Record<string, string> = {
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  checkcircle: "M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  doc: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  database: "M21 5c0 1.657-4.03 3-9 3S3 6.657 3 5s4.03-3 9-3 9 1.343 9 3ZM3 5v14c0 1.657 4.03 3 9 3s9-1.343 9-3V5M3 12c0 1.657 4.03 3 9 3s9-1.343 9-3",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  mail: "M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75",
  add: "M12 4.5v15m7.5-7.5h-15",
  sparkle: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
  check: "M4.5 12.75l6 6 9-13.5",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  play: "M6 4l14 8-14 8z",
  arrowright: "M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3",
  back: "M19 12H5m7 7-7-7 7-7",
  running: "M22 12h-4l-3 9L9 3l-3 9H2",
  trending: "M22 7l-8.5 8.5-5-5L2 17M16 7h6v6",
};

export function WizIcon(props: { name: string; size?: number; class?: string }) {
  const size = props.size ?? 16;
  return (
    <svg
      class={props.class ?? ""}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={WIZ_ICONS[props.name] ?? ""} />
    </svg>
  );
}

// ── Entry point accents (mockup colour + icon per card) ──────────────────────

const ACCENTS: Record<string, { icon: string; box: string }> = {
  "Month-end close": { icon: "calendar", box: "bg-brand-500 text-white" },
  "Bank reconciliation": { icon: "checkcircle", box: "bg-leaf-500 text-white" },
  "Vendor invoices": { icon: "doc", box: "bg-pump-500 text-white" },
  "Capital calls": { icon: "database", box: "bg-grape-500 text-white" },
  Payroll: { icon: "users", box: "bg-sun-500 text-white" },
  "Process Email": { icon: "mail", box: "bg-coral-500 text-white" },
};

export const FIELD_HEAD = "text-[11px] uppercase tracking-wide text-ink-400 font-semibold";

// ── Stepper ──────────────────────────────────────────────────────────────────

const STEPS = ["Choose", "Describe", "Review", "Build"];

const stepIndex = (steps: string[], label: string) => steps.indexOf(label) + 1;

export function Stepper(step: number, steps: string[] = STEPS) {
  return (
    <div class="flex flex-wrap items-center justify-center gap-2 mb-8">
      {steps.map((label, i) => {
        const n = i + 1;
        const isActive = n === step;
        const isDone = n < step;
        const dotCls = isActive
          ? "bg-brand-500 text-white"
          : isDone
            ? "bg-leaf-500 text-white"
            : "border border-ink/[0.15] text-ink-400";
        const labelCls = isActive
          ? "text-brand-600 dark:text-brand-300"
          : isDone
            ? "text-leaf-600 dark:text-leaf-300"
            : "text-ink-400";
        return (
          <>
            <div class="flex items-center gap-2">
              <span class={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${dotCls}`}>{n}</span>
              <span class={`text-sm font-semibold ${labelCls}`}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <svg class="w-4 h-4 text-ink-300 dark:text-ink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            )}
          </>
        );
      })}
    </div>
  );
}

export const ErrCard = ({ message, startOverHref = "/app/make-workflow" }: { message: string; startOverHref?: string }) => (
  <div class="max-w-2xl mx-auto px-4 py-6 md:py-8">
    <div class="card p-6 md:p-8">
      <div class="text-sm text-coral-600 dark:text-coral-300 mb-4">{message}</div>
      <a
        hx-get={startOverHref}
        hx-target="#main-panel"
        hx-swap="innerHTML"
        class="inline-flex items-center gap-2 rounded-xl border border-ink/[0.1] px-4 py-2 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 no-underline"
      >
        <WizIcon name="back" size={15} /> Start over
      </a>
    </div>
  </div>
);

// ── Step 1 — Choose ──────────────────────────────────────────────────────────

export const TPL_CARD =
  "flex flex-col items-start gap-3 rounded-xl border border-ink/[0.1] p-4 text-left transition-colors w-full cursor-pointer hover:border-brand-400 hover:bg-brand-50/40 dark:border-white/[0.1] dark:hover:border-brand-400 dark:hover:bg-brand-900/20";

export const makeWorkflowView = async (c: Context) => {
  const templates = ENTRY_POINTS.filter((e) => e.label !== "Process Email");
  const email = ENTRY_POINTS.find((x) => x.label === "Process Email")!;

  return c.html(
    <div class="max-w-3xl mx-auto px-4 py-6 md:py-8">
      {Stepper(1)}
      <div class="card p-6 md:p-8">
        <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">What are you making?</h1>
        <p class="text-sm text-ink-500 mt-1">Pick a starting point, or describe it from scratch. You'll review the plan before anything is built.</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
          <form hx-post="/app/make-workflow/start" hx-target="#main-panel" hx-swap="innerHTML">
            <input type="hidden" name="label" value="workflow" />
            <input type="hidden" name="seed" value="" />
            <input type="hidden" name="mode" value="regular" />
            <button type="submit" class={TPL_CARD}>
              <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-ink/[0.06] text-ink-500 dark:bg-white/[0.06] dark:text-white/70 p-2">
                <WizIcon name="add" size={18} />
              </span>
              <span class="min-w-0">
                <span class="block text-sm font-semibold text-ink dark:text-white">Start from scratch</span>
                <span class="block text-xs text-ink-400">Describe it in your own words</span>
              </span>
            </button>
          </form>

          {templates.map((e) => {
            const a = ACCENTS[e.label] ?? { icon: "sparkle", box: "bg-brand-500 text-white" };
            return (
              <form hx-post="/app/make-workflow/start" hx-target="#main-panel" hx-swap="innerHTML">
                <input type="hidden" name="label" value={e.label} />
                <input type="hidden" name="seed" value={e.template} />
                <input type="hidden" name="mode" value="regular" />
                <button type="submit" class={TPL_CARD}>
                  <span class={`flex h-9 w-9 items-center justify-center rounded-lg p-2 ${a.box}`}>
                    <WizIcon name={a.icon} size={18} />
                  </span>
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold text-ink dark:text-white">{e.label}</span>
                    <span class="block text-xs text-ink-400">{e.desc}</span>
                  </span>
                </button>
              </form>
            );
          })}

          <form hx-post="/app/make-workflow/start" hx-target="#main-panel" hx-swap="innerHTML">
            <input type="hidden" name="label" value="Process Email" />
            <input type="hidden" name="seed" value={email.template} />
            <input type="hidden" name="mode" value="email" />
            <button type="submit" class={TPL_CARD}>
              <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-coral-500 text-white p-2">
                <WizIcon name="mail" size={18} />
              </span>
              <span class="min-w-0">
                <span class="block text-sm font-semibold text-ink dark:text-white">Process Email</span>
                <span class="block text-xs text-ink-400">{email.desc}</span>
              </span>
            </button>
          </form>
        </div>
      </div>
    </div>,
  );
};

// ── Interview state ──────────────────────────────────────────────────────────

interface InterviewDraft {
  purpose: string;
  inputs: string[];
  steps: string[];
  rules: string[];
}

interface InterviewState {
  mode: "regular" | "email";
  label: string;
  seed: string;
  qa: { q: string; a: string }[];
  current: { q: string; hint: string } | null;
  draft: InterviewDraft;
  done: boolean;
  llmConfig: { provider: string; model: string; apiKey?: string };
  databaseId: string;
  userId: string;
}

const interviews = new Map<string, InterviewState>();

async function askInterviewer(
  state: InterviewState,
  extraAnswer?: string,
): Promise<{ question: string; hint: string; done: boolean; draft: InterviewDraft }> {
  const conversationLines = state.qa.map(
    (p) => `- You asked: "${p.q}"\n- They answered: "${p.a}"`,
  );
  if (extraAnswer != null) {
    conversationLines.push(`- They answered: "${extraAnswer}"`);
  }
  const conversation = conversationLines.length
    ? conversationLines.join("\n")
    : "No questions asked yet — ask the opening question.";

  let dataFilesLine = "No data files loaded in the workspace yet.";
  try {
    const dataNames = getSessionByDatabaseId(state.databaseId)?.getDataNames() ?? [];
    if (dataNames.length > 0) {
      dataFilesLine = dataNames.map((n) => `- ${n}`).join("\n");
    }
  } catch {}

  const systemPrompt = loadPrompt("pipeline/interviewer", {
    MODE: state.mode,
    SEED: state.seed
      ? `The user chose this starting point: "${state.seed}"`
      : "The user is starting from scratch (no template).",
    CONVERSATION: conversation,
    DRAFT: JSON.stringify(state.draft, null, 2),
    DATA_FILES: dataFilesLine,
  });

  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const p of state.qa) {
    messages.push({ role: "assistant", content: p.q });
    messages.push({ role: "user", content: p.a });
  }
  if (extraAnswer != null) messages.push({ role: "user", content: extraAnswer });

  // A brand-new interview has no user turn yet. OpenAI-compatible providers can
  // return an empty body when the request is system-only, so send a kickoff
  // user turn the model can answer (the opening question).
  if (messages.length === 0) {
    messages.push({ role: "user", content: "Start the interview." });
  }

  const result = await callLLM(state.llmConfig, {
    systemPrompt,
    messages,
    responseFormat: "json",
    temperature: 0.4,
    maxTokens: 3000,
  });

  // A truncated or non-JSON reply (the model hit the token cap mid-draft, or
  // returned an empty body) leaves `data` null. Surface it instead of silently
  // keeping the draft unchanged — otherwise the interview looks like it "does
  // nothing" while the right-hand draft panel never updates.
  if (!result.data || typeof result.data !== "object") {
    throw new Error(
      "The interviewer returned an incomplete response (it may have been cut off). Please try answering again.",
    );
  }

  const d = result.data as any;
  const draft: InterviewDraft = {
    purpose: typeof d.draft?.purpose === "string" ? d.draft.purpose : state.draft.purpose,
    inputs: Array.isArray(d.draft?.inputs) ? d.draft.inputs.map(String) : state.draft.inputs,
    steps: Array.isArray(d.draft?.steps) ? d.draft.steps.map(String) : state.draft.steps,
    rules: Array.isArray(d.draft?.rules) ? d.draft.rules.map(String) : state.draft.rules,
  };

  return {
    question: typeof d.question === "string" ? d.question : "",
    hint: typeof d.hint === "string" ? d.hint : "",
    done: !!d.done,
    draft,
  };
}

// ── Step 2 — Describe (live-draft interview) ─────────────────────────────────

function InterviewThread(state: InterviewState) {
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

function DraftPanel(draft: InterviewDraft) {
  const hasDraft = draft.purpose || draft.inputs.length > 0 || draft.steps.length > 0 || draft.rules.length > 0;
  return (
    <div class="rounded-xl border border-ink/[0.08] bg-[#F3F5F9] dark:bg-ink-800 dark:border-white/[0.08] p-4 h-fit">
      <div class="flex items-center justify-between mb-3">
        <span class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Draft so far</span>
        <span class="pill bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
          <WizIcon name="sparkle" size={11} /> live
        </span>
      </div>
      {!hasDraft ? (
        <div class="text-ink-400 italic">Nothing yet — answer a question to start.</div>
      ) : (
        <div class="space-y-3 text-sm">
          {draft.purpose && (
            <div>
              <div class="text-[10px] uppercase tracking-wide text-ink-400 font-semibold">Purpose</div>
              <div class="text-ink-700 dark:text-white/80">{draft.purpose}</div>
            </div>
          )}
          {draft.inputs.length > 0 && (
            <div>
              <div class="text-[10px] uppercase tracking-wide text-ink-400 font-semibold">Inputs</div>
              <div class="flex flex-wrap gap-1.5 mt-0.5">
                {draft.inputs.map((i) => (
                  <span class="pill bg-ink/[0.05] text-ink-600 dark:bg-white/[0.06] dark:text-white text-[11px] py-0.5">{i}</span>
                ))}
              </div>
            </div>
          )}
          {draft.steps.length > 0 && (
            <div>
              <div class="text-[10px] uppercase tracking-wide text-ink-400 font-semibold">Steps</div>
              <ol class="space-y-1 mt-0.5">
                {draft.steps.map((s, i) => (
                  <li class="flex items-center gap-1.5">
                    <span class="w-4 h-4 rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <span class="text-ink-700 dark:text-white/80 text-[13px]">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {draft.rules.length > 0 && (
            <div>
              <div class="text-[10px] uppercase tracking-wide text-ink-400 font-semibold">Rules</div>
              <div class="text-ink-700 dark:text-white/80 text-[13px]">{draft.rules.join(" · ")}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InterviewView(id: string, state: InterviewState) {
  const placeholder = state.current
    ? state.current.hint || "Your answer…"
    : state.done
      ? "Add anything else, or press Continue"
      : "Your answer…";

  return (
    <div class="max-w-3xl mx-auto px-4 py-6 md:py-8">
      {Stepper(2)}
      <div class="card p-6 md:p-8">
        <div class="flex items-center gap-2 mb-2">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-900/40 dark:text-brand-300 p-1.5">
            <WizIcon name="sparkle" size={16} />
          </span>
          <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">Describe your {state.label || "workflow"}</h1>
        </div>
        <p class="text-sm text-ink-500">
          I'll ask a few questions. Answer in your own words — watch the draft build as you go. Press{" "}
          <span class="font-semibold text-ink-700 dark:text-white/80">Continue</span> whenever it's good enough.
        </p>

        <div class="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 mt-5">
          <div>
            <div class="space-y-3">{InterviewThread(state)}</div>
            <form
              hx-post="/app/make-workflow/interview"
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
            <div class="mt-2 text-xs text-ink-400">The AI asks; you answer. Your answers fill the draft on the right.</div>
          </div>

          {DraftPanel(state.draft)}
        </div>

        <div class="flex items-center justify-between mt-6">
          <a
            hx-get="/app/make-workflow"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-1.5 rounded-xl border border-ink/[0.1] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 no-underline"
          >
            <WizIcon name="back" size={15} /> Back
          </a>
          <form hx-post="/app/make-workflow/interview/finalize" hx-target="#main-panel" hx-swap="innerHTML">
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

const startInterview = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) {
    return c.html(<ErrCard message="No workspace active." />);
  }

  const body = await c.req.parseBody();
  const label = ((body.label as string) || "").trim();
  const seed = ((body.seed as string) || "").trim();
  const mode: InterviewState["mode"] = body.mode === "email" ? "email" : "regular";

  const llmConfig = await getLLMConfigByDatabaseId(databaseId, user.userId);

  const state: InterviewState = {
    mode,
    label,
    seed,
    qa: [],
    current: null,
    draft: { purpose: "", inputs: [], steps: [], rules: [] },
    done: false,
    llmConfig: { provider: llmConfig.provider, model: llmConfig.model, apiKey: llmConfig.apiKey },
    databaseId,
    userId: user.userId,
  };

  const id = crypto.randomUUID();

  try {
    const next = await askInterviewer(state);
    state.draft = next.draft;
    state.done = next.done;
    if (next.question) state.current = { q: next.question, hint: next.hint };
  } catch (err: any) {
    return c.html(<ErrCard message={`Couldn't start the interview: ${err.message || String(err)}`} />);
  }

  interviews.set(id, state);
  return c.html(InterviewView(id, state));
};

const interviewStep = async (c: Context) => {
  const body = await c.req.parseBody();
  const id = ((body.interviewId as string) || "").trim();
  const state = interviews.get(id);
  if (!state) {
    return c.html(<ErrCard message="This interview expired — please start again." />);
  }

  const answer = ((body.answer as string) || "").trim();
  if (!answer) {
    return c.html(InterviewView(id, state));
  }

  try {
    if (state.current) {
      state.qa.push({ q: state.current.q, a: answer });
      state.current = null;
      const next = await askInterviewer(state);
      state.draft = next.draft;
      state.done = next.done;
      if (next.question) state.current = { q: next.question, hint: next.hint };
    } else {
      const next = await askInterviewer(state, answer);
      state.draft = next.draft;
      state.done = next.done;
      if (next.question) state.current = { q: next.question, hint: next.hint };
    }
  } catch (err: any) {
    return c.html(<ErrCard message={`Interview failed: ${err.message || String(err)}`} />);
  }

  return c.html(InterviewView(id, state));
};

async function planAndRender(state: InterviewState) {
  const qaText = state.qa.map((p) => `Q: ${p.q}\nA: ${p.a}`).join("\n\n");
  const d = state.draft;
  const draftBlock = [
    d.purpose ? `Purpose: ${d.purpose}` : "",
    d.inputs.length ? `Inputs: ${d.inputs.join(", ")}` : "",
    d.steps.length ? `Steps:\n${d.steps.map((s) => `- ${s}`).join("\n")}` : "",
    d.rules.length ? `Rules:\n${d.rules.map((r) => `- ${r}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const userMessage = [state.seed, qaText, draftBlock]
    .filter(Boolean)
    .join("\n\n");

  const params = {
    userMessage,
    databaseId: state.databaseId,
    userId: state.userId,
    llmConfig: state.llmConfig,
  };
  const steps = STEPS;

  try {
    const stage1 = await runBuildPipeline(params);
    if (!stage1.pendingPlan) {
      return <ErrCard message="Planning failed." />;
    }
    const planId = crypto.randomUUID();
    pendingPlans.set(planId, { plan: stage1.pendingPlan, params, steps });
    return ReviewView(planId, stage1, steps);
  } catch (err: any) {
    return <ErrCard message={`Error: ${err.message || String(err)}`} />;
  }
}

const finalizeInterview = async (c: Context) => {
  const body = await c.req.parseBody();
  const id = ((body.interviewId as string) || "").trim();
  const state = interviews.get(id);
  if (!state) {
    return c.html(<ErrCard message="This interview expired — please start again." />);
  }

  interviews.delete(id);
  return c.html(await planAndRender(state));
};

// ── Step 3 — Review ──────────────────────────────────────────────────────────

function ReviewView(planId: string, stage1: { pendingPlan?: unknown; text?: string }, steps: string[] = STEPS) {
  const plan = stage1.pendingPlan as any;
  const name = plan?.workflowName || "Workflow";
  const description = plan?.workflowDescription || stage1.text || "";
  const nodes = (plan?.nodes || []).filter(
    (n: any) => n.toolId !== "workflow_start" && n.toolId !== "workflow_end",
  );
  const auditChecks: { condition: string }[] = plan?.audit?.checks || [];

  return (
    <div class="max-w-2xl mx-auto px-4 py-6 md:py-8">
      {Stepper(stepIndex(steps, "Review"), steps)}
      <div class="card p-6 md:p-8">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">{name}</h1>
          <span class="pill bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <WizIcon name="sparkle" size={13} /> drafted by AI
          </span>
        </div>
        <p class="text-sm text-ink-500 mb-5">This is a draft of the procedure. Nothing has run yet. Approve it, or go back and adjust the description.</p>

        <div
          class="prose dark:prose-invert prose-sm max-w-none max-h-[46vh] overflow-y-auto bg-[#F3F5F9] dark:bg-ink-800 rounded-lg p-4"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(description) }}
        />

        {(nodes.length > 0 || auditChecks.length > 0) && (
          <details class="mt-4 group">
            <summary class="cursor-pointer text-xs font-semibold text-ink-400 hover:text-ink-500 select-none">
              Show the steps &amp; audit checks
            </summary>
            <div class="mt-3 space-y-4">
              {nodes.length > 0 && (
                <div>
                  <div class={FIELD_HEAD + " mb-1"}>Steps</div>
                  <ol class="space-y-1.5">
                    {nodes.map((n: any, i: number) => (
                      <li class="flex items-start gap-2">
                        <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300 text-xs font-bold">
                          {i + 1}
                        </span>
                        <span class="text-sm text-ink-700 dark:text-white/80">{n.label}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {auditChecks.length > 0 && (
                <div>
                  <div class={FIELD_HEAD + " mb-1"}>Audit checks</div>
                  <ul class="space-y-1">
                    {auditChecks.map((ch: any) => (
                      <li class="flex items-center gap-2 text-sm text-ink-700 dark:text-white/80">
                        <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-leaf-50 text-leaf-600 dark:bg-leaf-900/40 dark:text-leaf-300 p-1">
                          <WizIcon name="check" size={12} />
                        </span>
                        {ch.condition}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        )}

        <form
          hx-post="/app/make-workflow/build"
          hx-target="#main-panel"
          hx-swap="innerHTML"
          class="flex items-center justify-end gap-2 mt-5"
        >
          <input type="hidden" name="planId" value={planId} />
          <a
            hx-get="/app/make-workflow"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-ink-600 dark:text-white/80 bg-ink/[0.05] dark:bg-white/[0.06] hover:bg-ink/[0.08] rounded-xl no-underline"
          >
            Back
          </a>
          <button class="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-400 rounded-xl">
            Approve &amp; build <WizIcon name="check" size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Step 4 — Built ───────────────────────────────────────────────────────────

export const makeWorkflowBuildHandler = async (c: Context) => {
  const body = await c.req.parseBody();
  const planId = ((body.planId as string) || "").trim();
  const pending = pendingPlans.get(planId);
  if (!pending) {
    return c.html(<ErrCard message="Plan expired — please start again." />);
  }
  pendingPlans.delete(planId);

  // Record the build in a session so its progress streams into a visible record.
  const steps = pending.steps;
  const params = pending.params as any;
  let sessionId: string | undefined;
  try {
    const name = `Build: ${(pending.plan as any)?.workflowName || "workflow"}`;
    const session = await createSession(params.databaseId, params.userId, name);
    sessionId = session.session_id;
  } catch {
    sessionId = undefined;
  }

  const buildId = crypto.randomUUID();
  buildSteps.set(buildId, steps);
  startBuild(buildId, { ...params, approvedPlan: pending.plan, sessionId }, pending.plan);

  return c.html(buildInProgressPanel(buildId, "Starting…", pending.plan as any, steps));
};

function planStepLabels(plan: any): string[] {
  return (plan?.nodes || [])
    .filter((n: any) => n.toolId !== "workflow_start" && n.toolId !== "workflow_end")
    .map((n: any) => n.label);
}

function buildInProgressPanel(buildId: string, message: string, plan: any, wizSteps: string[] = STEPS) {
  const steps = planStepLabels(plan);
  return (
    <div
      class="max-w-2xl mx-auto px-4 py-6 md:py-8"
      hx-get={`/app/make-workflow/result/${buildId}`}
      hx-trigger="load, every 1200ms"
      hx-swap="outerHTML"
      hx-target="this"
    >
      {Stepper(stepIndex(wizSteps, "Build"), wizSteps)}
      <div class="card p-6 md:p-8">
        <div class="flex items-center gap-3 mb-4">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center">
            <span class="animate-spin rounded-full h-5 w-5 border-b-2 border-brand-500"></span>
          </span>
          <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">Building workflow…</h1>
        </div>
        <p class="text-sm text-ink-500 mb-5">{message}</p>

        {steps.length > 0 && (
          <ol class="space-y-2">
            {steps.map((label: string, i: number) => (
              <li class="flex items-center gap-2">
                <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300 text-xs font-bold">
                  {i + 1}
                </span>
                <span class="text-sm text-ink-700 dark:text-white/80">{label}</span>
              </li>
            ))}
            <li class="flex items-center gap-2">
              <span class="shrink-0 w-5 h-5 flex items-center justify-center">
                <span class="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-500"></span>
              </span>
              <span class="text-sm text-ink-400 dark:text-white/50">{message}</span>
            </li>
          </ol>
        )}
      </div>
    </div>
  );
}

function builtPanel(stage2: any, wfId: string, steps: string[] = STEPS) {
  return (
    <div class="max-w-2xl mx-auto px-4 py-6 md:py-8">
      {Stepper(stepIndex(steps, "Build"), steps)}
      <div class="card p-6 md:p-8">
        <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">Workflow built</h1>
        <p class="text-sm text-ink-500 mt-1">Written down in plain steps, tested, and ready to run.</p>

        <div class="mt-6 rounded-xl border border-leaf-200 bg-leaf-50/60 dark:border-leaf-800 dark:bg-leaf-900/20 p-4 flex items-start gap-3">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-leaf-500 text-white p-1.5">
            <WizIcon name="check" size={16} />
          </span>
          <div>
            <div class="text-sm font-semibold text-leaf-700 dark:text-leaf-300">Your workflow is ready.</div>
            <div class="text-xs text-leaf-600 dark:text-leaf-300/80 mt-0.5">It's on your Home list. You can run it now or later.</div>
          </div>
        </div>

        {stage2.text && (
          <div class="whitespace-pre-wrap text-sm text-ink-700 dark:text-white/80 mt-4">{stage2.text}</div>
        )}

        <div class="flex items-center justify-end gap-2 mt-5">
          <a
            hx-get="/app/overview"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="px-4 py-2 text-sm font-semibold text-ink-600 dark:text-white/80 bg-ink/[0.05] dark:bg-white/[0.06] hover:bg-ink/[0.08] rounded-xl no-underline"
          >
            Done
          </a>
          {wfId && (
            <a
              hx-get={`/app/view/${wfId}`}
              hx-target="#main-panel"
              hx-swap="innerHTML"
              class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-400 rounded-xl no-underline"
            >
              <WizIcon name="play" size={14} /> View workflow
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export const makeWorkflowResultHandler = async (c: Context) => {
  const buildId = c.req.param("buildId");
  const state = getBuild(buildId);
  const steps = buildSteps.get(buildId) ?? STEPS;

  if (!state || state.status === "running") {
    const user = c.get("user") as User;
    const message = user.currentDatabaseId
      ? getBuildProgress(user.currentDatabaseId) || "Preparing…"
      : "Preparing…";
    return c.html(buildInProgressPanel(buildId, message, state?.plan, steps));
  }

  if (state.status === "error") {
    return c.html(<ErrCard message={`Build failed: ${state.error}`} />);
  }

  const stage2 = state.result ?? {};
  const wfId = stage2.workflowId || "";
  return c.html(builtPanel(stage2, wfId, steps));
};

// ── Re-exports kept for the router (legacy describe view removed) ────────────

export { startInterview, interviewStep, finalizeInterview };
