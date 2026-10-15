// Per-capability MCP scope wiring for `api.mcp` / `api.callMcp` and the chat
// orchestrator's per-request scope fan-out.
//
// Capabilities declare a `setScope` in their module; the capability registry
// collects them, so scoping is derived from the registry rather than a
// hand-maintained map. Sessions/build are intentionally absent (they need
// sessionId/userId/appHook context a standalone run cannot supply) and are
// wired separately in the orchestrator.

import { listCapabilities } from "../capabilities/registry";

function setterFor(serverName: string): ((databaseId: string) => void) | undefined {
  return listCapabilities().find((c) => c.serverName === serverName)?.setScope;
}

/** Set the active workspace scope for a given capability server name (no-op if
 *  the name is not a capability — e.g. sessions/build). */
export function setMcpServerScope(serverName: string, databaseId: string): void {
  setterFor(serverName)?.(databaseId);
}

/** Set the active workspace scope on every capability (the orchestrator's
 *  per-request fan-out, replacing the old one-line-per-server block). */
export function setAllScopes(databaseId: string): void {
  for (const cap of listCapabilities()) {
    cap.setScope?.(databaseId);
  }
}
