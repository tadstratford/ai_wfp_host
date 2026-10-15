import type { FC } from "hono/jsx";

export interface ComposerProps {
  sessionId: string;
  workflowId?: string;
  todoId?: string;
  prefill?: string;
  placeholder?: string;
}

export const Composer: FC<ComposerProps> = ({
  sessionId,
  workflowId,
  todoId,
  prefill,
  placeholder = "Ask the agent...",
}) => {

  return (
    <div data-agent-composer-slot="area" class="agent-composer-area shrink-0 px-3 py-2 text-start">
      <input type="hidden" id="build-session-id" name="session_id" value={sessionId} />
      <input type="hidden" id="build-workflow-id" name="workflow_id" value={workflowId || ""} />
      {todoId && <input type="hidden" id="build-todo-id" name="todo_id" value={todoId} />}

      <div
        data-agent-composer-slot="root"
        class="agent-composer-root relative flex flex-col rounded-xl border border-ink/[0.12] dark:border-white/[0.1] bg-[#F3F5F9] dark:bg-ink-800/60 transition-colors focus-within:border-brand-400 dark:focus-within:border-brand-500"
      >
        <button
          type="button"
          id="composer-save-prompt"
          hx-post="/sessions/api/save-prompt"
          hx-include="#build-input"
          hx-target="#saved-prompts"
          hx-swap="innerHTML"
          title="Save prompt"
          aria-label="Save prompt"
          class="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-md text-ink-400 dark:text-white/50 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-ink/[0.06] dark:hover:bg-white/[0.08] transition-colors"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z" />
          </svg>
        </button>

        <div data-agent-composer-slot="editor-wrap" class="agent-composer-editor-wrap px-2 pt-2 pb-1">
          <textarea
            id="build-input"
            name="message"
            rows={3}
            data-placeholder={placeholder}
            placeholder={placeholder}
            class="agent-composer-editor flex-1 resize-none w-full bg-transparent text-sm text-ink dark:text-white outline-none leading-[1.625rem] min-h-[3.25rem] max-h-[10rem] overflow-y-auto placeholder:text-ink-400 dark:placeholder:text-white/40 border-0 focus:ring-0 p-0"
            style="min-height:3.25rem; max-height:10rem"
            oninput="autoExpandTextarea(this)"
            hx-post={`/sessions/api/build-send?sessionId=${sessionId}`}
            hx-include="#build-input, #build-session-id, #build-workflow-id, #build-todo-id"
            hx-swap="none"
            hx-indicator="#build-spinner"
            hx-trigger="keydown[key=='Enter'&&!shiftKey] consume"
            hx-on--after-request="var el=document.getElementById('build-input'); el.value=''; el.style.height='auto'"
          >
            {prefill || ""}
          </textarea>
        </div>

        <div data-agent-composer-slot="toolbar" class="agent-composer-toolbar flex items-center gap-1 px-2 py-1.5">
          <span class="inline-flex shrink-0">
            <a
              id="composer-attach"
              hx-get="/app/data"
              hx-target="#main-panel"
              hx-swap="innerHTML"
              data-nav-path="/app/data"
              title="Load data"
              aria-label="Load data"
              class="composer-btn shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-ink-400 dark:text-white/50 hover:text-ink-700 dark:hover:text-white hover:bg-ink/[0.06] dark:hover:bg-white/[0.08] cursor-pointer no-underline"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </a>
          </span>

          <div class="flex-1" />

          <span class="inline-flex shrink-0">
            <button
              type="button"
              id="composer-voice"
              class="composer-btn shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-ink-400 dark:text-white/50 hover:text-ink-700 dark:hover:text-white hover:bg-ink/[0.06] dark:hover:bg-white/[0.08]"
              aria-label="Dictate"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </button>
          </span>

          <button
            type="button"
            id="composer-send"
            class="shrink-0 flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-white hover:bg-brand-600 transition-[opacity,transform] duration-150 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
            hx-post={`/sessions/api/build-send?sessionId=${sessionId}`}
            hx-include="#build-input, #build-session-id, #build-workflow-id, #build-todo-id"
            hx-swap="none"
            hx-indicator="#build-spinner"
            hx-on--after-request="var el=document.getElementById('build-input'); el.value=''; el.style.height='auto'"
            aria-label="Send message"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
        </div>
      </div>

      <div id="build-spinner" class="htmx-indicator flex items-center justify-center gap-2 py-2">
        <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-500"></div>
        <span class="text-xs text-ink-400">Working...</span>
      </div>
    </div>
  );
};
