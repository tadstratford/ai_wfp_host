export { initCapabilities } from "./loader";
export { defineTool } from "./tool";
export { capabilitySecretKey, saveCapabilitySecret, getCapabilitySecret, deleteCapabilitySecret } from "./auth";
export {
  registerCapability,
  hasTool,
  getToolClass,
  getToolOutput,
  getCapabilityForTool,
  isAllowedFromCustomCode,
  listCapabilities,
  getCapability,
  capabilityTools,
  toolsForCapability,
  toolNamesWhere,
} from "./registry";
export type {
  CapabilityManifest,
  CapabilityModule,
  CapabilityTool,
  ToolDef,
  CapabilityAuth,
  CapabilityTrust,
  CapabilityKind,
  ToolClass,
  ToolOutputContract,
} from "./types";
