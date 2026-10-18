import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "planning",
  name: "Budgeting",
  version: "1.0.0",
  description: "Lean budget-vs-actual store at reporting-account grain.",
  trust: "core",
  kind: "builtin",
  group: { key: "budgeting", label: "Budgeting", defaultEnabled: false },
  prompt: "Build a budget vs actuals variance report for this fiscal year.",
  skills: ["budgeting"],
};

export const planningCapability: CapabilityModule = {
  manifest,
  serverName: "planning",
  setScope,
  tools,
};

registerCapability(planningCapability);
