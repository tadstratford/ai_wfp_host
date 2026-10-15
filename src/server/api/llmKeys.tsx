import { Context } from "hono";
import { userManager } from "@backend/core/admin/userManager";
import type { User } from "@backend/types";

export const llmKeysListHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const providers = await userManager.listLlmKeys(user.userId);
  return c.json({ providers });
};

export const llmKeysSaveHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const body = await c.req.parseBody();
  const provider = (body.provider as string || "").trim();
  const key = (body.key as string || "").trim();

  if (!provider) {
    return c.json({ error: "provider is required" }, 400);
  }

  if (key) {
    await userManager.saveLlmKey(user.userId, provider, key);
    return c.json({ ok: true, provider, configured: true });
  } else {
    await userManager.deleteLlmKey(user.userId, provider);
    return c.json({ ok: true, provider, configured: false });
  }
};

export const llmKeysGetHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const provider = c.req.query("provider") || "";

  if (!provider) {
    return c.json({ error: "provider query param required" }, 400);
  }

  const key = await userManager.getLlmKey(user.userId, provider);
  return c.json({ provider, configured: !!key });
};
