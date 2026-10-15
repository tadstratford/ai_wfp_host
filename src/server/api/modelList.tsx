import { Context } from "hono";
import providersJson from "@backend/core/llm/llm-providers.json";

export const modelListHandler = async (c: Context) => {
  const { providers } = providersJson as any;
  return c.json({ providers });
};
