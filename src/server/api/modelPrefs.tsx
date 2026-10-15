import { Context } from "hono";
import { userManager } from "@backend/core/admin/userManager";
import type { User } from "@backend/types";

export const modelPrefsGetHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const config = await userManager.getLlmConfigByDatabaseId(user.currentDatabaseId);
  return c.json({
    provider: config?.llm_provider || user.llmProvider || "",
    model: config?.llm_model || user.llmModel || "",
  });
};

export const modelPrefsPostHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const body = await c.req.parseBody();
  const provider = (body.provider as string) || "";
  const model = (body.model as string) || "";
  if (!provider || !model) {
    return c.json({ error: "provider and model are required" }, 400);
  }
  await userManager.updateLlmPreferences(user.userId, provider, model);
  return c.json({ ok: true, provider, model });
};
