import type { FC } from "hono/jsx";
import { CHAT_CAPABILITIES } from "@shared/chatCapabilities";

/**
 * Capabilities panel — one-click prompt templates that append into the composer.
 * Each entry is a plain prompt; the Jev classifier routes the combined message.
 */
export const Capabilities: FC = () => {
  return (
    <details open class="rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white/60 dark:bg-ink-900/40 p-4">
      <summary class="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500 hover:text-ink-600 dark:hover:text-ink-300">
        Capabilities
      </summary>
      <ul class="mt-3 space-y-1.5">
        {CHAT_CAPABILITIES.map((cap) => (
          <li key={cap.key}>
            <button
              type="button"
              data-prompt={JSON.stringify(cap.prompt)}
              onclick="appendToComposer(this)"
              title={cap.prompt}
              class="w-full text-left text-sm text-ink-700 dark:text-white/80 truncate rounded-lg px-2 py-1.5 hover:bg-ink/[0.05] dark:hover:bg-white/[0.06] transition-colors"
            >
              {cap.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
};
