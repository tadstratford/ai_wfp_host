import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "plans",
  name: "Plans",
  version: "1.0.0",
  description: "Plan / strategy entry management.",
  trust: "core",
  kind: "builtin",
};

export const plansCapability: CapabilityModule = {
  manifest,
  serverName: "plans",
  setScope,
  tools,
};

registerCapability(plansCapability);
