# Tools

> Last updated: 2026-10-14

Dynamic tool registry — discovers, categorizes, and resolves workflow tools. Unifies native tools and MCP tools under a single API.

## Files

| File | Purpose |
|---|---|
| `index.ts` | Barrel exports from registry and categories. |
| `registry.ts` | Core tool registry. Discovers native tools from `workflow/run/`, manages MCP tool mapping, resolves tool definitions and execution functions. |
| `categories.ts` | Tool category map. Defines display labels, sort order, and colors for each category. |
| `reportRenderer.ts` | Renders report data (HTML reports, widgets). |

## Subdirectories

None. Shared tool utilities live alongside this module — `reportRenderer.ts` here, and the QuickBooks API client under the `qbo` capability (`src/capabilities/qbo/client.ts`).

## Tool Categories

| Key | Label | Purpose |
|---|---|---|
| `custom_tool` | Custom Tools | User-defined tools (from tool library). |
| `flow` | Flow Control | Workflow control: start, end, pause, conditions. |
| `acctg` | Accounting | Accounting operations: GL entries, reports, reconciliations. |
| `file` | Inputs and Outputs | File I/O: CSV upload, export, data loading. |
| `integrations` | Integrations | External service connectors (QBO, MCP servers). |
| `ai` | AI & Automation | LLM-powered tools: summarize, classify, extract. |
| `other` | Other | Fallback for uncategorized tools. |

## How Tool Discovery Works

1. **Native tools**: `discoverTools()` scans `src/workflow/run/` for subdirectories. Each directory must export a `*_definition` function and a `Tool_run` (or default export) function.
2. **MCP tools**: During `initMcp()`, all tools from all MCP servers are registered via `registerMcpTool()`. They get stub definitions pointing to their server.

## Tool Scope

All tools — native and MCP — are **global**. Registered once at startup, visible to all workspaces. The `McpAggregator` and `toolRegistry` are both singletons.

Context filtering (which workspace's data a tool operates on) is handled **at the tool level**, not the registry level. The MCP servers use the active workspace's `databaseId` for OAuth tokens and `WorkspaceSession` for data. The registry just routes by tool name.

## Key Exports

```ts
// Tool resolution
export async function getToolDefinition(toolId: string, databaseId?: string): Promise<ToolDefinition | null>;
export async function getToolFunction(toolId: string, databaseId?: string): Promise<Function | null>;
export async function getToolsList(databaseId?: string): Promise<ToolList[]>;

// Registry management
export async function getToolRegistry(): Promise<Map<string, DiscoveredTool>>;
export async function refreshToolRegistry(): Promise<void>;

// MCP bridge
export function registerMcpTool(toolName: string, serverName: string): void;
export function isMcpTool(toolId: string): boolean;
export function getMcpServerName(toolId: string): string | null;
```

## Related Modules

- `src/workflow/run/` — Native tool implementations discovered by this registry
- `src/mcp/init.ts` — Registers MCP tools into this registry on startup
- `src/workflow/executor.ts` — Uses `getToolDefinition()` and `getToolFunction()` to execute workflow nodes
