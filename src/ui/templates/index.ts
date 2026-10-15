import type { WidgetDefinition } from "@shared/types/widgetTypes";
import { validateWidgetData } from "./validate";

export interface TemplateContext {
  databaseId: string;
  sessionId: string;
  messageId: string;
}

export type TemplateFn = (data: unknown, ctx: TemplateContext) => string;

interface RegistryEntry {
  definition: WidgetDefinition;
  fn: TemplateFn;
}

// Use globalThis to survive Bun --hot module reloads
const g = globalThis as any;
if (!g.__templateRegistry) {
  g.__templateRegistry = new Map<string, RegistryEntry>();
}
const registry: Map<string, RegistryEntry> = g.__templateRegistry;

export function register(def: WidgetDefinition, fn: TemplateFn): void {
  registry.set(def.widget_id, { definition: def, fn });
}

export function render(name: string, data: unknown, ctx: TemplateContext): string {
  const entry = registry.get(name);
  if (!entry) {
    const available = [...registry.keys()].join(", ") || "(none)";
    return `<div class="text-sm text-red-500">Template "${name}" not found. Available: ${available}</div>`;
  }

  const errors = validateWidgetData(entry.definition, data);
  if (errors.length > 0) {
    const list = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
    return `<div class="text-sm text-red-500">Widget "${name}" received invalid data:<ul class="list-disc list-inside mt-1">${list}</ul></div>`;
  }

  return entry.fn(data, ctx);
}

export function has(name: string): boolean {
  return registry.has(name);
}

export function listTemplates(): string[] {
  return [...registry.keys()];
}

export function getWidgetDefinition(name: string): WidgetDefinition | undefined {
  return registry.get(name)?.definition;
}

export function listWidgetDefinitions(): WidgetDefinition[] {
  return [...registry.values()].map((e) => e.definition);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
