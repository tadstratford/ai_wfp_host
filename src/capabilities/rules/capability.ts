import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "rules",
  name: "Workspace Rules",
  version: "1.0.0",
  description: "Workspace-authored skills CRUD (stored under wfp.skills[], formerly wfp.rules[]).",
  trust: "core",
  kind: "builtin",
};

export const rulesCapability: CapabilityModule = {
  manifest,
  serverName: "rules",
  setScope,
  tools,
};

registerCapability(rulesCapability);
