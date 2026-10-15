import { Context } from "hono";
import type { User } from "@backend/types";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { getLLMConfigByDatabaseId } from "@backend/core/user/getLLMApiKey";
import { callLLM } from "@backend/core/llm/llm-client";
import { loadPrompt } from "@chat/prompts/loader";
import { markdownToHtml } from "@backend/utilities/markdownToHtml";
import { Stepper, WizIcon, FIELD_HEAD, TPL_CARD, ErrCard } from "../workflows/wizardPage";

/**
 * Make Rule — full-page 4-step wizard, mirroring the Make Workflow wizard.
 *
 *   1. Choose   — a starting point (rule-shaped cards) or from scratch.
 *   2. Describe — a live-draft interview: the AI asks one question at a time and
 *                 a "Draft so far" panel grows on the right.
 *   3. Review   — the drafted rule (name, description, tags, and
 *                 rendered markdown content).
 *   4. Save     — persisted to wfp.rules[] via ws.upsertRule.
 */

const RULE_STEPS = ["Choose", "Describe", "Review", "Save"];

const RULE_ACCENTS: Record<string, { icon: string; box: string }> = {
  "Report preferences": { icon: "doc", box: "bg-brand-500 text-white" },
  "Company rules": { icon: "shield", box: "bg-leaf-500 text-white" },
  "Data conventions": { icon: "database", box: "bg-grape-500 text-white" },
};

interface RuleEntry {
  label: string;
  desc: string;
  icon: string;
  seed: string;
}

const RULE_ENTRY_POINTS: RuleEntry[] = [
  {
    label: "Report preferences",
    desc: "How reports should be formatted and styled",
    icon: "doc",
    seed: "A rule describing how reports should be formatted: layout, sections, terminology, and the style to apply on every report.",
  },
  {
    label: "Company rules",
    desc: "Allocation rules, thresholds, and policies",
    icon: "shield",
    seed: "A rule describing company rules and policies: allocation methods, thresholds, and constraints that must always be followed.",
  },
  {
    label: "Data conventions",
    desc: "How to read and interpret a data file",
    icon: "database",
    seed: "A rule describing how to read and interpret a particular data file: what each column means, its units, and known quirks.",
  },
];

// ── Interview state ──────────────────────────────────────────────────────────

interface RuleDraft {
  name: string;
  description: string;
  tags: string[];
  content: string;
}

interface RuleInterviewState {
  label: string;
  seed: string;
  qa: { q: string; a: string }[];
  current: { q: string; hint: string } | null;
  draft: RuleDraft;
  done: boolean;
  llmConfig: { provider: string; model: string; apiKey?: string };
  databaseId: string;
}

const ruleInterviews = new Map<string, RuleInterviewState>();

async function askRuleInterviewer(
  state: RuleInterviewState,
  extraAnswer?: string,
): Promise<{ question: string; hint: string; done: boolean; draft: RuleDraft }> {
  const conversationLines = state.qa.map(
    (p) => `- You asked: "${p.q}"\n- They answered: "${p.a}"`,
  );
  if (extraAnswer != null) {
    conversationLines.push(`- They answered: "${extraAnswer}"`);
  }
  const conversation = conversationLines.length
    ? conversationLines.join("\n")
    : "No questions asked yet — ask the opening question.";

  const systemPrompt = loadPrompt("pipeline/skill-interviewer", {
    SEED: state.seed
      ? `The user chose this starting point: "${state.seed}"`
      : "The user is starting from scratch (no template).",
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
    maxTokens: 1536,
  });

  const d = result.data ?? {};

  const draft: RuleDraft = {
    name: typeof d.draft?.name === "string" ? d.draft.name : state.draft.name,
    description: typeof d.draft?.description === "string" ? d.draft.description : state.draft.description,
    tags: Array.isArray(d.draft?.tags) ? d.draft.tags.map(String) : state.draft.tags,
    content: typeof d.draft?.content === "string" ? d.draft.content : state.draft.content,
  };

  return {
    question: typeof d.question === "string" ? d.question : "",
    hint: typeof d.hint === "string" ? d.hint : "",
    done: !!d.done,
    draft,
  };
}

// ── Step 1 — Choose ──────────────────────────────────────────────────────────

export const makeRuleView = async (c: Context) => {
  return c.html(
    <div class="max-w-3xl mx-auto px-4 py-6 md:py-8">
      {Stepper(1, RULE_STEPS)}
      <div class="card p-6 md:p-8">
        <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">What rules or methods should the AI follow?</h1>
        <p class="text-sm text-ink-500 mt-1">Describe the rules, preferences, or methods for this workspace. They apply in both chat and workflow builds. You'll review before saving.</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
          {RULE_ENTRY_POINTS.map((e) => {
            const a = RULE_ACCENTS[e.label] ?? { icon: "sparkle", box: "bg-brand-500 text-white" };
            return (
              <form hx-post="/app/make-rule/start" hx-target="#main-panel" hx-swap="innerHTML">
                <input type="hidden" name="label" value={e.label} />
                <input type="hidden" name="seed" value={e.seed} />
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

          <form hx-post="/app/make-rule/start" hx-target="#main-panel" hx-swap="innerHTML">
            <input type="hidden" name="label" value="rule" />
            <input type="hidden" name="seed" value="" />
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
        </div>
      </div>
    </div>,
  );
};

// ── Step 2 — Describe (live-draft interview) ─────────────────────────────────

function RuleInterviewThread(state: RuleInterviewState) {
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

function RuleDraftPanel(draft: RuleDraft) {
  const hasDraft = draft.name || draft.description || draft.content;
  return (
    <div class="rounded-xl border border-ink/[0.08] bg-[#F3F5F9] dark:bg-ink-800 dark:border-white/[0.08] p-4 h-fit">
      <div class="flex items-center justify-between mb-3">
        <span class={FIELD_HEAD}>Draft so far</span>
        <span class="pill bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
          <WizIcon name="sparkle" size={11} /> live
        </span>
      </div>
      {!hasDraft ? (
        <div class="text-ink-400 italic">Nothing yet — answer a question to start.</div>
      ) : (
        <div class="space-y-3 text-sm">
          {draft.name && (
            <div>
              <div class={FIELD_HEAD}>Name</div>
              <div class="text-ink-700 dark:text-white/80 font-mono text-[13px]">{draft.name}</div>
            </div>
          )}
          {draft.description && (
            <div>
              <div class={FIELD_HEAD}>Description</div>
              <div class="text-ink-700 dark:text-white/80">{draft.description}</div>
            </div>
          )}
          {draft.tags.length > 0 && (
            <div>
              <div class={FIELD_HEAD}>Tags</div>
              <div class="flex flex-wrap gap-1.5 mt-0.5">
                {draft.tags.map((t) => (
                  <span class="pill bg-ink/[0.05] text-ink-600 dark:bg-white/[0.06] dark:text-white text-[11px] py-0.5">{t}</span>
                ))}
              </div>
            </div>
          )}
          {draft.content && (
            <div>
              <div class={FIELD_HEAD}>Content</div>
              <div
                class="prose prose-sm dark:prose-invert max-w-none text-ink-700 dark:text-white/80"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(draft.content) }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RuleInterviewView(id: string, state: RuleInterviewState) {
  const placeholder = state.current
    ? state.current.hint || "Your answer…"
    : state.done
      ? "Add anything else, or press Continue"
      : "Your answer…";

  return (
    <div class="max-w-3xl mx-auto px-4 py-6 md:py-8">
      {Stepper(2, RULE_STEPS)}
      <div class="card p-6 md:p-8">
        <div class="flex items-center gap-2 mb-2">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-900/40 dark:text-brand-300 p-1.5">
            <WizIcon name="sparkle" size={16} />
          </span>
          <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">Describe your {state.label || "rules"}</h1>
        </div>
        <p class="text-sm text-ink-500">
          I'll ask a few questions. Answer in your own words — watch the rule draft build as you go. Press{" "}
          <span class="font-semibold text-ink-700 dark:text-white/80">Continue</span> whenever it's good enough.
        </p>

        <div class="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 mt-5">
          <div>
            <div class="space-y-3">{RuleInterviewThread(state)}</div>
            <form
              hx-post="/app/make-rule/interview"
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
            <div class="mt-2 text-xs text-ink-400">The AI asks; you answer. Your answers fill the rule draft on the right.</div>
          </div>

          {RuleDraftPanel(state.draft)}
        </div>

        <div class="flex items-center justify-between mt-6">
          <a
            hx-get="/app/make-rule"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-1.5 rounded-xl border border-ink/[0.1] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 no-underline"
          >
            <WizIcon name="back" size={15} /> Back
          </a>
          <form hx-post="/app/make-rule/interview/finalize" hx-target="#main-panel" hx-swap="innerHTML">
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

const startRuleInterview = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) {
    return c.html(<ErrCard message="No workspace active." startOverHref="/app/make-rule" />);
  }

  const body = await c.req.parseBody();
  const label = ((body.label as string) || "").trim();
  const seed = ((body.seed as string) || "").trim();

  const llmConfig = await getLLMConfigByDatabaseId(databaseId, user.userId);

  const state: RuleInterviewState = {
    label,
    seed,
    qa: [],
    current: null,
    draft: { name: "", description: "", tags: [], content: "" },
    done: false,
    llmConfig: { provider: llmConfig.provider, model: llmConfig.model, apiKey: llmConfig.apiKey },
    databaseId,
  };

  const id = crypto.randomUUID();

  try {
    const next = await askRuleInterviewer(state);
    state.draft = next.draft;
    state.done = next.done;
    if (next.question) state.current = { q: next.question, hint: next.hint };
  } catch (err: any) {
    return c.html(<ErrCard message={`Couldn't start the interview: ${err.message || String(err)}`} startOverHref="/app/make-rule" />);
  }

  ruleInterviews.set(id, state);
  return c.html(RuleInterviewView(id, state));
};

const ruleInterviewStep = async (c: Context) => {
  const body = await c.req.parseBody();
  const id = ((body.interviewId as string) || "").trim();
  const state = ruleInterviews.get(id);
  if (!state) {
    return c.html(<ErrCard message="This interview expired — please start again." startOverHref="/app/make-rule" />);
  }

  const answer = ((body.answer as string) || "").trim();
  if (!answer) {
    return c.html(RuleInterviewView(id, state));
  }

  try {
    if (state.current) {
      state.qa.push({ q: state.current.q, a: answer });
      state.current = null;
      const next = await askRuleInterviewer(state);
      state.draft = next.draft;
      state.done = next.done;
      if (next.question) state.current = { q: next.question, hint: next.hint };
    } else {
      const next = await askRuleInterviewer(state, answer);
      state.draft = next.draft;
      state.done = next.done;
      if (next.question) state.current = { q: next.question, hint: next.hint };
    }
  } catch (err: any) {
    return c.html(<ErrCard message={`Interview failed: ${err.message || String(err)}`} startOverHref="/app/make-rule" />);
  }

  return c.html(RuleInterviewView(id, state));
};

// ── Step 3 — Review ──────────────────────────────────────────────────────────

function RuleReviewView(id: string, state: RuleInterviewState) {
  const d = state.draft;
  const name = d.name || "New rule";

  return (
    <div class="max-w-2xl mx-auto px-4 py-6 md:py-8">
      {Stepper(3, RULE_STEPS)}
      <div class="card p-6 md:p-8">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">{name}</h1>
          <span class="pill bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <WizIcon name="sparkle" size={13} /> drafted by AI
          </span>
        </div>
        <p class="text-sm text-ink-500 mb-5">This is a draft of the rule. Nothing has been saved yet. Approve it, or go back and adjust the description.</p>

        {d.description && (
          <p class="text-sm text-ink-500 mb-4 italic">{d.description}</p>
        )}

        <div class="flex flex-wrap gap-2 mb-4">
          {d.tags.map((t) => (
            <span class="pill bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">{t}</span>
          ))}
        </div>

        <div
          class="prose dark:prose-invert prose-sm max-w-none max-h-[46vh] overflow-y-auto bg-[#F3F5F9] dark:bg-ink-800 rounded-lg p-4"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(d.content) }}
        />

        <form
          hx-post="/app/make-rule/save"
          hx-target="#main-panel"
          hx-swap="innerHTML"
          class="flex items-center justify-end gap-2 mt-5"
        >
          <input type="hidden" name="interviewId" value={id} />
          <a
            hx-get="/app/make-rule"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-ink-600 dark:text-white/80 bg-ink/[0.05] dark:bg-white/[0.06] hover:bg-ink/[0.08] rounded-xl no-underline"
          >
            Back
          </a>
          <button class="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-400 rounded-xl">
            Save rule <WizIcon name="check" size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Step 4 — Save ────────────────────────────────────────────────────────────

const saveRuleHandler = async (c: Context) => {
  const body = await c.req.parseBody();
  const id = ((body.interviewId as string) || "").trim();
  const state = ruleInterviews.get(id);
  if (!state) {
    return c.html(<ErrCard message="This interview expired — please start again." startOverHref="/app/make-rule" />);
  }
  ruleInterviews.delete(id);

  const ws = getSessionByDatabaseId(state.databaseId);
  if (!ws) {
    return c.html(<ErrCard message="No workspace session." startOverHref="/app/make-rule" />);
  }

  const d = state.draft;
  const name = (d.name || state.label || "rule").trim().replace(/\s+/g, "-").toLowerCase();
  const content = d.content.trim();

  if (!name || !content) {
    return c.html(<ErrCard message="The rule needs a name and content before it can be saved." startOverHref="/app/make-rule" />);
  }

  ws.upsertRule({
    name,
    description: d.description.trim() || undefined,
    tags: d.tags,
    content,
  });

  return c.html(
    <div class="max-w-2xl mx-auto px-4 py-6 md:py-8">
      {Stepper(4, RULE_STEPS)}
      <div class="card p-6 md:p-8">
        <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">Rule saved</h1>
        <p class="text-sm text-ink-500 mt-1">Written down and ready to be activated when it matches a task.</p>

        <div class="mt-6 rounded-xl border border-leaf-200 bg-leaf-50/60 dark:border-leaf-800 dark:bg-leaf-900/20 p-4 flex items-start gap-3">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-leaf-500 text-white p-1.5">
            <WizIcon name="check" size={16} />
          </span>
          <div>
            <div class="text-sm font-semibold text-leaf-700 dark:text-leaf-300">Your rule is ready.</div>
            <div class="text-xs text-leaf-600 dark:text-leaf-300/80 mt-0.5">It's on your Rules list. You can edit it later.</div>
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
            hx-get="/app/rules"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-400 rounded-xl no-underline"
          >
            <WizIcon name="check" size={14} /> View rules
          </a>
        </div>
      </div>
    </div>,
  );
};

export { startRuleInterview, ruleInterviewStep, saveRuleHandler };

const finalizeRuleInterview = async (c: Context) => {
  const body = await c.req.parseBody();
  const id = ((body.interviewId as string) || "").trim();
  const state = ruleInterviews.get(id);
  if (!state) {
    return c.html(<ErrCard message="This interview expired — please start again." startOverHref="/app/make-rule" />);
  }

  return c.html(RuleReviewView(id, state));
};

export { finalizeRuleInterview };
