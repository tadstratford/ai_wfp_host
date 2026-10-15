import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "workflows",
  name: "Workflows",
  version: "1.0.0",
  description: "Workflow CRUD and execution operations.",
  trust: "core",
  kind: "builtin",
  skills: ["workflow-build"],
};

export const workflowsCapability: CapabilityModule = {
  manifest,
  serverName: "workflows",
  setScope,
  tools,
};

registerCapability(workflowsCapability);
