import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "qbodemo",
  name: "QBO Demo",
  version: "1.0.0",
  description: "Demo-only QuickBooks company (Acme Fund Services) with a fund-administrator chart of accounts and funds as classes. Reads and posts against an in-bundle dataset — never touches Intuit.",
  trust: "core",
  kind: "builtin",
  group: { key: "qbodemo", label: "QBO Demo", defaultEnabled: false },
  prompt: "Build a budget vs actuals report for the demo fund-administrator company.",
  skills: ["qbodemo-budgeting", "qbodemo-journaling"],
  dataAccess: { reads: ["plan_facts", "plan_dim"], writes: [] },
};

export const qbodemoCapability: CapabilityModule = {
  manifest,
  serverName: "qbodemo",
  setScope,
  tools,
};

registerCapability(qbodemoCapability);
