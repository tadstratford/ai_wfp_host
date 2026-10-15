// Clean LLM Manager exports - Message-based interface
// All LLM calls use standard OpenAI-compatible messages

// Main LLM Functions - Clean message-based interface
export {
  runLLM,
  runLLMWithUsage,
  runLLMForJSON,
  getModelName,
} from "./together_llm_enhanced";

// Vision API - Separate because it handles images
export {
  callVisionAPI,
  parseVisionResponse,
  type VisionRequest,
  type VisionResponse,
} from "./visionAPI";

// Types
export type {
  ChatMessage,
  LLMOptions,
  LLMResult,
  LLMResultWithUsage,
  LLMUsageData,
  LLMConfig,
} from "@backend/types";

// Configuration access
import { settings } from "@backend/core/settings/settings";

export function getLLMConfig() {
  return settings.getLLMConfig();
}
