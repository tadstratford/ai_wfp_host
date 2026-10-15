import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "metadata",
  name: "Workspace Metadata",
  version: "1.0.0",
  description: "Workspace metadata: name, format version, data inventory, notes.",
  trust: "core",
  kind: "builtin",
};

export const metadataCapability: CapabilityModule = {
  manifest,
  serverName: "metadata",
  setScope,
  tools,
};

registerCapability(metadataCapability);
