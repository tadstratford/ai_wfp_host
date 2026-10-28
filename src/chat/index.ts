import * as vers8 from "./vers_8/index";
import * as vers9 from "./vers_9/index";
import * as vers10 from "./vers_10/index";
import * as vers11 from "./vers_11/index";

const ORCHESTRATOR = (process.env.ORCHESTRATOR || "vers_8").trim().toLowerCase();
const impl =
  ORCHESTRATOR === "vers_9" ? vers9 :
  ORCHESTRATOR === "vers_10" ? vers10 :
  ORCHESTRATOR === "vers_11" ? vers11 :
  vers8;

if (!["vers_8", "vers_9", "vers_10", "vers_11"].includes(ORCHESTRATOR)) {
  console.warn(
    `[chat] Unknown ORCHESTRATOR "${ORCHESTRATOR}". Only "vers_8", "vers_9", "vers_10", and "vers_11" are supported. Falling back to vers_8.`,
  );
}
const label =
  impl === vers11 ? "vers_11 (rule-aware orchestrator)" :
  impl === vers10 ? "vers_10 (storytelling data-review)" :
  impl === vers9 ? "vers_9 (LLM plans + executes, Jev verifies)" :
  "vers_8";
console.log(`[chat] ORCHESTRATOR = ${label}`);

export const handleMessage = impl.handleMessage;
export const parseCommand = impl.parseCommand;
