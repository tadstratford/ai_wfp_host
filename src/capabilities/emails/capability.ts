import { setScope } from "./scope";
import { registerCapability } from "../registry";
import type { CapabilityManifest, CapabilityModule } from "../types";
import { tools } from "./tools";

const manifest: CapabilityManifest = {
  key: "emails",
  name: "Email Outbound",
  version: "1.0.0",
  description: "Outbound email via Resend (send_email), subject to the workspace outbound allowlist.",
  trust: "core",
  kind: "builtin",
  group: { key: "email-outbound", label: "Email Outbound", defaultEnabled: false },
  skills: ["email-outbound"],
};

export const emailsCapability: CapabilityModule = {
  manifest,
  serverName: "emails",
  setScope,
  tools,
};

registerCapability(emailsCapability);
