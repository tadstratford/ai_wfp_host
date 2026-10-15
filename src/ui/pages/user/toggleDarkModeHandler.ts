import { Context } from "hono";
import { userManager } from "@backend/core/admin/userManager";
import type { User } from "@backend/types";
import { settings } from "@backend/core/settings/settings";

/**
 * Handle toggling dark mode for a user
 * POST /user/toggle-dark-mode
 */
export const handleToggleDarkMode = async (c: Context) => {
    const user = c.get("user") as User;

    if (!user || !user.userId) {
        return c.text("Unauthorized", 401);
    }

    try {
        const newDarkMode = !user.darkMode;
        await userManager.updateDarkMode(user.userId, newDarkMode);

        // If it's the "default" user, also update settings file for immediate effect
        if (user.userId === 'default') {
            settings.setDarkMode(newDarkMode);
        }

        return c.text("OK", 200);

    } catch (error) {
        console.error(`[ToggleDarkMode] Error updating user ${user.userId}:`, error);
        return c.text("Error updating preference", 500);
    }
};
