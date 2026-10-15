import { Context } from "hono";
import { userManager } from "@backend/core/admin/userManager";
import type { User } from "@backend/types";
import { secretsListHtml } from "../app/settingsPanel";

/**
 * POST /user/secrets
 * Save a named secret (encrypted in admin_users).
 */
export const saveSecretHandler = async (c: Context): Promise<Response> => {
    const user = c.get("user") as User;
    const body = await c.req.parseBody();
    const name = ((body.name as string) || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const value = ((body.value as string) || "").trim();

    if (!name) {
        const secrets = await userManager.listSecrets(user.userId);
        return c.html(secretsListHtml(secrets, "Name is required."));
    }

    // For new secrets, value is required. For updates, value can be empty (keep existing).
    const existing = await userManager.listSecretNames(user.userId);
    const isNew = !existing.includes(name);
    if (isNew && !value) {
        const secrets = await userManager.listSecrets(user.userId);
        return c.html(secretsListHtml(secrets, "Value is required for new secrets."));
    }

    await userManager.saveSecret(user.userId, name, value);
    const secrets = await userManager.listSecrets(user.userId);
    return c.html(secretsListHtml(secrets));
};

/**
 * POST /user/secrets/delete
 * Delete a named secret.
 */
export const deleteSecretHandler = async (c: Context): Promise<Response> => {
    const user = c.get("user") as User;
    const body = await c.req.parseBody();
    const name = ((body.name as string) || "").trim();

    if (name) {
        await userManager.deleteSecret(user.userId, name);
    }

    const secrets = await userManager.listSecrets(user.userId);
    return c.html(secretsListHtml(secrets));
};

/**
 * GET /user/secrets
 * List secret names (never values).
 */
export const listSecretsHandler = async (c: Context): Promise<Response> => {
    const user = c.get("user") as User;
    const secrets = await userManager.listSecrets(user.userId);
    return c.html(secretsListHtml(secrets));
};
