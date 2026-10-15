import { readdirSync, statSync } from "fs";
import { join } from "path";
import type { ToolDefinition, Session } from "@backend/types";
import { TOOL_API_VERSION, isCompatibleVersion } from "@backend/types/toolTypes";
import { getCatEntry } from "./categories";

export interface ToolList {
    tool_id: string;
    name: string;
    description: string;
    color?: string;
    category?: string;
    isCustom?: boolean;
    updated_at?: string;
    description_md?: string;
}

interface ToolModule {
    [key: string]: any;
}

interface DiscoveredTool {
    toolId: string;
    definition: ToolDefinition;
    executionFunction: (session: Session) => Promise<Session>;
}

// ── MCP Tool Mapping ──────────────────────────────────────────────────
// When a workflow node references a tool_id that was previously a native
// tool (e.g., "qbo_accounts_list"), the registry routes it through the
// run_MCP bridge. The mapping is populated by initMcp() after MCP servers
// are registered.

const mcpToolMap = new Map<string, { serverName: string; description?: string }>();

export function registerMcpTool(toolName: string, serverName: string, description?: string) {
    mcpToolMap.set(toolName, { serverName, description });
}

export function unregisterMcpTool(toolName: string): void {
    mcpToolMap.delete(toolName);
}

export function unregisterMcpToolsForServer(serverName: string): void {
    for (const [toolName, info] of mcpToolMap.entries()) {
        if (info.serverName === serverName) mcpToolMap.delete(toolName);
    }
}

export function isMcpTool(toolId: string): boolean {
    return mcpToolMap.has(toolId);
}

export function getMcpServerName(toolId: string): string | null {
    return mcpToolMap.get(toolId)?.serverName ?? null;
}

export function getMcpDescription(toolId: string): string | undefined {
    return mcpToolMap.get(toolId)?.description;
}

function mcpDefinitionFor(toolName: string, serverName: string, description?: string): ToolDefinition {
    return {
        tool_id: toolName,
        name: toolName,
        description: description || `MCP tool on ${serverName} server`,
        category: "integrations",
        apiVersion: "1.0.0",
        inputs: [],
        outputs: [{ name: "result", type: "string" }],
        color: getCatEntry("integrations").color,
    };
}

// ── Native Tool Discovery ─────────────────────────────────────────────

export async function discoverTools(): Promise<Map<string, DiscoveredTool>> {
    const toolsMap = new Map<string, DiscoveredTool>();
    const toolsDir = join(__dirname, "..", "..", "workflow", "run");

    console.log("[ToolRegistry] Discovering tools...");

    if (!statSync(toolsDir, { throwIfNoEntry: false })?.isDirectory()) {
        console.log("[ToolRegistry] No workflow/run directory — skipping discovery");
        return toolsMap;
    }

    const entries = readdirSync(toolsDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith("_")) continue;

        const toolPath = join(toolsDir, entry.name);
        try {
            const toolModule: ToolModule = await import(toolPath);
            const defName = Object.keys(toolModule).find((k) =>
                k === "tool_definition" || k.endsWith("_definition")
            );
            const execName = Object.keys(toolModule).find(
                (k) =>
                    k === "Tool_run" || (!k.endsWith("_definition") && typeof toolModule[k] === "function")
            );
            if (!defName || !execName) {
                console.warn(`[ToolRegistry] Skipping run/${entry.name}: missing functions`);
                continue;
            }

            const definition: ToolDefinition = await toolModule[defName]();
            const executionFn = toolModule[execName];

            if (!definition.tool_id || !definition.name) {
                console.warn(`[ToolRegistry] Invalid definition in run/${entry.name}`);
                continue;
            }

            if (definition.apiVersion && !isCompatibleVersion(definition.apiVersion, TOOL_API_VERSION)) {
                console.error(`[ToolRegistry] ${definition.tool_id} incompatible`);
                continue;
            }

            if (!definition.color) definition.color = getCatEntry(definition.category).color;

            toolsMap.set(definition.tool_id, { toolId: definition.tool_id, definition, executionFunction: executionFn });
            console.log(`[ToolRegistry] + ${definition.tool_id}`);
        } catch (error: any) {
            console.error(`[ToolRegistry] Failed to load run/${entry.name}:`, error.message);
        }
    }

    console.log(`[ToolRegistry] ${toolsMap.size} native tools`);
    return toolsMap;
}

// ── Singleton ─────────────────────────────────────────────────────────

let toolRegistry: Map<string, DiscoveredTool> | null = null;

export async function getToolRegistry(): Promise<Map<string, DiscoveredTool>> {
    if (!toolRegistry) {
        toolRegistry = await discoverTools();
    }
    return toolRegistry;
}

// ── Public API ────────────────────────────────────────────────────────

export async function getToolDefinition(
    toolId: string,
    databaseId?: string
): Promise<ToolDefinition | null> {
    const registry = await getToolRegistry();
    const native = registry.get(toolId);
    if (native) return native.definition;

    const mcp = mcpToolMap.get(toolId);
    if (mcp) return mcpDefinitionFor(toolId, mcp.serverName, mcp.description);

    return null;
}

export async function getToolFunction(toolId: string, databaseId?: string) {
    const registry = await getToolRegistry();
    const native = registry.get(toolId);
    if (native) return native.executionFunction;

    const mcp = mcpToolMap.get(toolId);
    if (mcp) return null; // MCP tools are routed in the executor to run_MCP

    return null;
}

export async function getToolsList(databaseId?: string): Promise<ToolList[]> {
    const registry = await getToolRegistry();
    const nativeTools: ToolList[] = Array.from(registry.values()).map((tool) => ({
        tool_id: tool.definition.tool_id,
        name: tool.definition.name,
        description: tool.definition.description,
        color: tool.definition.color,
        category: tool.definition.category as ToolList["category"],
        isCustom: false,
    }));

    // Include MCP tools
    for (const [toolName, { serverName, description }] of mcpToolMap.entries()) {
        // Avoid duplicates with native tools
        if (!nativeTools.some((t) => t.tool_id === toolName)) {
            nativeTools.push({
                tool_id: toolName,
                name: toolName,
                description: description || `MCP tool on ${serverName} server`,
                category: "integrations",
                isCustom: false,
            });
        }
    }

    return nativeTools;
}

export async function refreshToolRegistry(): Promise<void> {
    console.log("[ToolRegistry] Refreshing registry...");
    toolRegistry = null;
    await getToolRegistry();
    console.log("[ToolRegistry] Registry refreshed");
}
