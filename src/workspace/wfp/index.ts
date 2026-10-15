/**
 * WFP_API — Host barrel.
 * Post-M12 the surface is canonical wfp-api 1.1.0.
 */

export { createWFP_API } from "./createAPI";
export { PauseSignal, isPauseSignal } from "./PauseSignal";
export type {
  WFP_API,
  Result,
  NodeContext,
  ParameterType,
  TypedEnvelope,
  MetaData,
  MetaType,
  AddMessageInput,
  ChatTurn,
  PausePrompt,
  PauseResult,
  RunMessage,
} from "./types";

// Re-export ToolDefinition for convenience
export type { ToolDefinition } from "@backend/types";
