import { describe, it, expect } from "bun:test";
import { capabilitySecretKey } from "./auth";

describe("capabilitySecretKey", () => {
  it("namespaces a credential by capability and workspace scope", () => {
    expect(capabilitySecretKey("qbo", "ws-abc")).toBe("capability:qbo:ws-abc");
  });

  it("distinguishes workspaces for the same capability", () => {
    const a = capabilitySecretKey("stripe", "ws-1");
    const b = capabilitySecretKey("stripe", "ws-2");
    expect(a).not.toBe(b);
  });
});
