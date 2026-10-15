import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "todos",
  name: "Todos",
  version: "1.0.0",
  description: "Todo management: create, update, list, complete, delete.",
  trust: "core",
  kind: "builtin",
};

export const todosCapability: CapabilityModule = {
  manifest,
  serverName: "todos",
  setScope,
  tools,
};

registerCapability(todosCapability);
