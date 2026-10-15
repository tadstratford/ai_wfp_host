import { Context } from "hono";
import type { User } from "@backend/types";
import { clearAllUserData } from "@backend/core/user-data/index";

/**
 * POST /app/clear-data — clears all data from app_user_data.
 * Workflows, tools, and knowledge are preserved.
 *
 * Returns empty file list HTML when hx-target is #data-file-list,
 * or plain text otherwise.
 */
export const clearDataHandler = async (c: Context) => {
  const user = c.get("user") as User;
  if (!user.currentDatabaseId) {
    return c.text("No database", 400);
  }

  await clearAllUserData(user.currentDatabaseId);
  console.log("🧹 [App] Data cleared");

  // If called from the data panel (targets #data-file-list), return empty state HTML
  const target = c.req.header("HX-Target");
  if (target === "data-file-list") {
    return c.html(
      <p class="text-sm text-ink-400 dark:text-ink-500">
        No data loaded. Upload files above, paste data in the chat, or run a workflow.
      </p>,
    );
  }

  return c.text("Data cleared", 200);
};
