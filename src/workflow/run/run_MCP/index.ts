import { WFP_API, Result, ToolDefinition } from '@backend/core/wfp';
import { aggregator } from '../../../mcp/aggregator';
import { setMcpServerScope } from '@mcp/scope';

/**
 * Run MCP Tool — Universal MCP Bridge
 *
 * Calls any MCP tool registered with the McpAggregator. Works with both
 * internal MCP servers (QBO, FPA, WFP State) and external third-party
 * servers (web fetch, currency, Slack, etc.).
 *
 * One tool, one code path, any MCP server. This is the Runner's protocol
 * bridge to the MCP ecosystem — no per-server wrappers needed.
 */
export const Tool_run = async (api: WFP_API): Promise<Result> => {
    const serverName = String(api.getParameter('serverName') ?? '');
    const toolName = String(api.getParameter('toolName') ?? '');

    let args: Record<string, unknown> = {};
    try {
        const raw = api.getParameter('args');
        if (typeof raw === 'string') {
            args = JSON.parse(raw);
        } else if (typeof raw === 'object' && raw !== null) {
            args = raw as Record<string, unknown>;
        }
    } catch {
        args = {};
    }

    api.addMessage({
        role: 'tool',
        markdown: `Calling MCP tool **${toolName}**${serverName ? ` on \`${serverName}\`` : ''}...`,
        json: { serverName, toolName, args },
    });

    await aggregator.getAllTools();

    // Re-scope the target server from this run's databaseId before invoking it,
    // so MCP tools resolve the correct workspace even in a standalone workflow
    // run (where the chat orchestrator's ambient scope was never set).
    if (api.databaseId) setMcpServerScope(serverName, api.databaseId);

    const result = await aggregator.callTool(toolName, args);

    // Surface MCP tool failures — the MCP SDK sets `isError` on the result when
    // the tool's handler returned an error. Without this, a failing tool would
    // masquerade as "✓ completed" and downstream steps would run on bad data.
    if ((result as any)?.isError) {
        const contentArray = (result as any).content as any[];
        const errText = Array.isArray(contentArray)
            ? contentArray.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            : String((result as any).error ?? '');
        return { status: 'error', statusMessage: errText || `${toolName} failed` };
    }

    const contentArray = (result as any).content as any[];
    const textContent = contentArray
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');

    let parsed: unknown;
    if (textContent) {
        try {
            parsed = JSON.parse(textContent);
        } catch {
            parsed = textContent;
        }
    } else {
        parsed = contentArray;
    }

    api.setParameter('result', parsed);

    let resultMd = `✓ **${toolName}** completed.`;
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
      const keys = Object.keys(parsed[0]).slice(0, 8);
      const header = "| " + keys.join(" | ") + " |";
      const sep = "|" + keys.map(() => "---").join("|") + "|";
      const rows = parsed.slice(0, 50).map((row: any) =>
        "| " + keys.map((k) => {
          const v = row[k];
          if (v === null || v === undefined) return "";
          return String(v).replace(/\|/g, "\\|").slice(0, 100);
        }).join(" | ") + " |"
      ).join("\n");
      resultMd = `✓ **${toolName}** — ${parsed.length} results\n\n${header}\n${sep}\n${rows}`;
      if (parsed.length > 50) resultMd += `\n\n_…and ${parsed.length - 50} more rows_`;
    } else if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      resultMd = `✓ **${toolName}** completed.\n\n\`\`\`json\n${JSON.stringify(parsed, null, 2).slice(0, 4000)}\n\`\`\``;
    } else if (typeof parsed === "string" && parsed.length > 0) {
      // Don't dump generated HTML/report artifacts into the run log — the
      // follow-up chat_download step delivers them.
      const looksHtml = /^\s*<!doctype html|^\s*<html|^\s*</i.test(parsed);
      resultMd = looksHtml
        ? `✓ **${toolName}** completed.`
        : `✓ **${toolName}** completed.\n\n${parsed.slice(0, 4000)}`;
    }

    api.addMessage({
        role: 'tool',
        markdown: resultMd,
        json: { serverName, toolName, result: parsed },
    });

    return { status: 'success' };
};

export const tool_definition = async (): Promise<ToolDefinition> => ({
    tool_id: 'run_MCP',
    name: 'Run MCP Tool',
    apiVersion: '1.0.0',
    description: 'Call any MCP tool from any connected MCP server.',
    description_md: `## What it does
Calls an MCP tool registered with the MCP aggregator. Works with both internal MCP servers (QBO, FPA) and external third-party MCP servers (web fetch, currency, Slack, etc.).

## Inputs
- **serverName** — the name of the MCP server (e.g., "qbo", "fetch")
- **toolName** — the name of the tool to call (e.g., "qbo_gl_review", "fetch_url")
- **args** — JSON string with the tool's arguments (e.g., \`{"url": "https://..."}\`)

## Outputs
- **result** — the tool's response. Auto-detected as string, number, JSON object, or JSON array. Available to downstream nodes as \`{{result}}\`.

## Notes
This is the universal bridge between workflow nodes and the MCP ecosystem. One tool calls any MCP server. For external services (currency APIs, web scraping, third-party data), use this instead of building per-service wrapper tools.`,
    category: 'bridge',
    inputs: [
        { name: 'serverName', type: 'string', value: '', required: true },
        { name: 'toolName', type: 'string', value: '', required: true },
        { name: 'args', type: 'string', value: '{}', required: false },
    ],
    outputs: [
        { name: 'result', type: 'string' },
    ],
});
