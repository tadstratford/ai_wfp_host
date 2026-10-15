// Host re-exports the canonical wfp-api types (M12).
//
// Post-M12 the host's WFP_API surface IS the canonical wfp-api 1.1.0
// interface. This file used to maintain a parallel (legacy) type set —
// now it just re-exports so existing call sites keep compiling.

export type {
  WFP_API,
  MetaData,
  MetaType,
  TypedEnvelope,
  AddMessageInput,
  ChatTurn,
  PausePrompt,
  PauseResult,
  RunMessage,
} from "wfp-api";

// Compatibility shim — the old `ParameterType` alias is gone from the spec
// but a couple of legacy host call sites still reference it.
export type ParameterType = "string" | "number" | "boolean" | "object" | "array";

// Compatibility shim — old host code expected `Result` and `NodeContext`
// to be exported from here. They're host-internal now.
export interface Result {
  status: "success" | "error" | "paused";
  statusMessage?: string;
  error?: string;
  data?: any;
}

export interface NodeContext {
  id: string;
  label: string;
  tool_id: string;
}
