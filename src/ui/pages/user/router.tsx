import { Hono } from "hono";
import { handleToggleDarkMode } from "./toggleDarkModeHandler";
import { saveSecretHandler, deleteSecretHandler, listSecretsHandler } from "./secretsHandler";
import { llmKeysListHandler, llmKeysSaveHandler, llmKeysGetHandler } from "@server/api/llmKeys";

export const userRouter = new Hono();

// API-only routes (called from /app settingsPanel)
userRouter.post("/toggle-dark-mode", handleToggleDarkMode);

// Secrets management
userRouter.get("/secrets", listSecretsHandler);
userRouter.post("/secrets", saveSecretHandler);
userRouter.post("/secrets/delete", deleteSecretHandler);

// LLM provider API keys — stored as llm_key_{provider} secrets
userRouter.get("/llm-keys", llmKeysListHandler);
userRouter.post("/llm-keys", llmKeysSaveHandler);
userRouter.get("/llm-key", llmKeysGetHandler);
