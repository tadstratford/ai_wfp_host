import type { FC } from "hono/jsx";
import { Context } from "hono";
import type { User } from "@backend/types";
import { listUserData } from "@backend/core/user-data/index";

export interface DataRef {
  name: string;
}

export const DataRefs: FC<{ items: DataRef[] }> = ({ items }) => {
  return (
    <details class="rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white/60 dark:bg-ink-900/40 p-4">
      <summary class="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500 hover:text-ink-600 dark:hover:text-ink-300">
        Data
      </summary>
      {items.length === 0 ? (
        <p class="text-xs text-ink-400 dark:text-ink-500 mt-3">No data yet.</p>
      ) : (
        <ul class="space-y-1.5 mt-3">
          {items.map((it) => (
            <li key={it.name}>
              <button
                type="button"
                data-data-ref
                data-name={it.name}
                title="Click to insert · double-click to edit"
                class="w-full text-left text-sm text-ink-700 dark:text-white/80 truncate rounded-lg px-2 py-1.5 hover:bg-ink/[0.05] dark:hover:bg-white/[0.06] transition-colors"
              >
                {it.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
};

/**
 * GET /sessions/api/data-refs — render the data list for the chat right rail.
 * Returns only the card content; the wrapper lives in renderChatContent.
 */
export const dataRefsHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const items = databaseId ? await listUserData(databaseId) : [];
  return c.html(<DataRefs items={items} />);
};
