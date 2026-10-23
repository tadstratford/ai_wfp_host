import * as vers8 from "./vers_8/index";
import * as vers9 from "./vers_9/index";

const ORCHESTRATOR = (process.env.ORCHESTRATOR || "vers_8").trim().toLowerCase();
const impl = ORCHESTRATOR === "vers_9" ? vers9 : vers8;

if (ORCHESTRATOR !== "vers_8" && ORCHESTRATOR !== "vers_9") {
  console.warn(
    `[chat] Unknown ORCHESTRATOR "${ORCHESTRATOR}". Only "vers_8" and "vers_9" are supported. Falling back to vers_8.`,
  );
}
console.log(`[chat] ORCHESTRATOR = ${impl === vers9 ? "vers_9 (LLM plans + executes, Jev verifies)" : "vers_8"}`);

export const handleMessage = impl.handleMessage;
export const parseCommand = impl.parseCommand;
