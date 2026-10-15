const ORCHESTRATOR = (process.env.ORCHESTRATOR || "vers_8").trim().toLowerCase();
if (ORCHESTRATOR !== "vers_8") {
  console.warn(
    `[chat] Unknown ORCHESTRATOR "${ORCHESTRATOR}". Only "vers_8" is supported.`,
  );
}

export { handleMessage, parseCommand } from "./vers_8/index";
