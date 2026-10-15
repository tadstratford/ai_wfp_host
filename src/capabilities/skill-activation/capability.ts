import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "skill-activation",
  name: "Skill Activation",
  version: "1.0.0",
  description: "App skill catalog and activation.",
  trust: "core",
  kind: "builtin",
};

export const skillActivationCapability: CapabilityModule = {
  manifest,
  serverName: "skill-activation",
  setScope,
  tools,
};

registerCapability(skillActivationCapability);
