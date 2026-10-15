import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "rules",
  name: "Workspace Rules",
  version: "1.0.0",
  description: "Workspace rules CRUD over wfp.rules[].",
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
