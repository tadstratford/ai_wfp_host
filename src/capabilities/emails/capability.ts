import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "emails",
  name: "Email",
  version: "1.0.0",
  description: "Workspace email inbox + outbound send_email.",
  trust: "core",
  kind: "builtin",
  group: { key: "email-outbound", label: "Outbound Email", defaultEnabled: false },
  skills: ["email-outbound"],
};

export const emailsCapability: CapabilityModule = {
  manifest,
  serverName: "emails",
  setScope,
  tools,
};

registerCapability(emailsCapability);
