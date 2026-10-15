/**
 * WidgetDefinition — a widget's runtime definition, mirroring ToolDefinition.
 *
 * A widget renders a typed `data` payload into a self-contained HTML artifact
 * (e.g. "account-table"). The definition is the single source of truth for that
 * payload's shape: `schema` (a JSON-Schema subset) is used to validate at render
 * time, and `description_md` (which documents the shape) is injected into the
 * build pipeline so the planner emits a correct payload.
 */

export interface WidgetDefinition {
  /** Registry key (and `chat_download(widget=…)` name), e.g. "account-table". */
  widget_id: string;
  name: string;
  description: string;
  /** LLM-facing markdown: what the widget is + a JSON example of `data`. */
  description_md: string;
  /** JSON Schema subset (type / required / properties / items) for the `data` payload. */
  schema: Record<string, unknown>;
  apiVersion: string;
}
