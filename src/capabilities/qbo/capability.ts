import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "qbo",
  name: "QBO",
  version: "1.0.0",
  description: "Live QuickBooks Online report analysis, audit, and journaling.",
  trust: "integration",
  kind: "builtin",
  group: { key: "qbo", label: "QBO", defaultEnabled: false },
  prompt: "Give me the QBO Profit & Loss for this year to date.",
  skills: ["qbo-analysis", "qbo-audit", "qbo-journaling"],
  auth: { type: "oauth2" },
  dataAccess: { reads: ["plan_facts", "plan_dim"], writes: [] },
};

export const qboCapability: CapabilityModule = {
  manifest,
  serverName: "qbo",
  setScope,
  tools,
};

registerCapability(qboCapability);
