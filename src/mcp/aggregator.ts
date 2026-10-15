import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

type SubAppConnector = (serverTransport: Transport) => Promise<void>;

interface ToolRoute {
  server: string;
  toolName: string;
}

class McpAggregator {
  private clients = new Map<string, Client>();
  // Exported tool name → route (server + real tool name on that server).
  private toolRoutes = new Map<string, ToolRoute>();
  // Server name → tool-name prefix ("" for built-in in-memory servers).
  private serverPrefix = new Map<string, string>();

  async registerSubApp(name: string, connectFn: SubAppConnector) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await connectFn(serverTransport);

    const client = new Client(
      { name: `host-${name}`, version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    this.clients.set(name, client);
    this.serverPrefix.set(name, "");
    console.log(`[McpAggregator] Registered "${name}" server`);
  }

  /** Connect an external MCP server over an arbitrary transport (network).
   *  `prefix` namespaces the server's tool names to avoid collisions. */
  async registerRemoteServer(name: string, transport: Transport, prefix?: string) {
    const client = new Client(
      { name: `remote-${name}`, version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(transport);

    this.clients.set(name, client);
    this.serverPrefix.set(name, prefix ?? "");
    console.log(`[McpAggregator] Connected remote server "${name}"`);
  }

  async disconnectServer(name: string) {
    const client = this.clients.get(name);
    if (!client) return;
    try {
      await client.close();
    } catch (err: any) {
      console.warn(`[McpAggregator] Error closing "${name}":`, err.message);
    }
    this.clients.delete(name);
    this.serverPrefix.delete(name);
    for (const [tool, route] of this.toolRoutes) {
      if (route.server === name) this.toolRoutes.delete(tool);
    }
    console.log(`[McpAggregator] Disconnected server "${name}"`);
  }

  hasServer(name: string): boolean {
    return this.clients.has(name);
  }

  serverCount(): number {
    return this.clients.size;
  }

  private exportedName(server: string, toolName: string): string {
    const prefix = this.serverPrefix.get(server);
    return prefix ? `${prefix}_${toolName}` : toolName;
  }

  async getAllTools() {
    const tools: any[] = [];
    this.toolRoutes.clear();

    for (const [serverName, client] of this.clients.entries()) {
      try {
        const { tools: serverTools } = await client.listTools();
        for (const tool of serverTools) {
          const exported = this.exportedName(serverName, tool.name);
          tools.push({ ...tool, name: exported });
          this.toolRoutes.set(exported, { server: serverName, toolName: tool.name });
        }
      } catch (err: any) {
        console.error(`[McpAggregator] Failed to list tools for "${serverName}":`, err.message);
      }
    }

    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>) {
    const route = this.toolRoutes.get(name);
    if (!route) {
      throw new Error(`Tool "${name}" not found in any registered server`);
    }

    const client = this.clients.get(route.server)!;
    return client.callTool({ name: route.toolName, arguments: args });
  }

  getToolServerMap(): ReadonlyMap<string, string> {
    const map = new Map<string, string>();
    for (const [name, route] of this.toolRoutes) map.set(name, route.server);
    return map;
  }
}

export const aggregator = new McpAggregator();
