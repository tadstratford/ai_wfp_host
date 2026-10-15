import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "judge",
  name: "Classifier (Jev)",
  version: "1.0.0",
  description: "Classifier judgment over data.",
  trust: "core",
  kind: "builtin",
};

export const judgeCapability: CapabilityModule = {
  manifest,
  serverName: "judge",
  setScope,
  tools,
};

registerCapability(judgeCapability);
