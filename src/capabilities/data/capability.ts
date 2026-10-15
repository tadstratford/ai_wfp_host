import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "data",
  name: "Workspace Data",
  version: "1.0.0",
  description: "User data CRUD: upload, list, read, aggregate, delete data entries.",
  trust: "core",
  kind: "builtin",
  skills: ["data-handling", "data-account-check"],
};

export const dataCapability: CapabilityModule = {
  manifest,
  serverName: "data",
  setScope,
  tools,
};

registerCapability(dataCapability);
