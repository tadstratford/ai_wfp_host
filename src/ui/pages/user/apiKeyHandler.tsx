import { Context } from "hono";
import { userManager } from "@backend/core/admin/userManager";
import type { User } from "@backend/types";

/**
 * POST /user/api-key
 * Save or clear the user's Anthropic API key.
 * Encrypted with APP_SECRET and stored in admin_users.
 */
export const saveApiKeyHandler = async (c: Context): Promise<Response> => {
    const user = c.get("user") as User;
    const body = await c.req.parseBody();
    const key = ((body.key as string) || "").trim();

    if (key) {
        await userManager.saveApiKey(user.userId, key);
        return c.html(
            <p id="api-key-status" class="text-sm text-leaf-600 dark:text-leaf-300">
                Key saved ({key.slice(0, 10)}...). Active on next request.
            </p>
        );
    } else {
        await userManager.clearApiKey(user.userId);
        return c.html(
            <p id="api-key-status" class="text-sm text-sun-600 dark:text-sun-300">
                Key removed.
            </p>
        );
    }
};
