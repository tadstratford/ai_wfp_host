import { register, type TemplateContext } from ".";
import type { WidgetDefinition } from "@shared/types/widgetTypes";

const entityManagerDefinition: WidgetDefinition = {
  widget_id: "entity-manager",
  name: "Entity Manager",
  description: "Interactive entity list with inline add/edit/delete.",
  description_md: `## What it is
An interactive entity manager rendered inline in the chat (HTMX). Data is
\`{ entities: [{ id, code, name, is_primary, active }], _mode, _editId, _add }\`.`,
  schema: {},
  apiVersion: "1.0.0",
};

register(entityManagerDefinition, (data: unknown, ctx: TemplateContext) => {
  const entities = (Array.isArray(data) ? data : data && typeof data === "object" ? (data as any).entities ?? [] : []) as any[];
  const mode = (data as any)?._mode || "view";
  const editId = (data as any)?._editId || "";
  const addOpen = (data as any)?._add === true;

  const rows = entities.map((e) => {
    if (editId === e.id) return editRow(e, ctx);
    return viewRow(e, ctx);
  }).join("");

  const addSection = addOpen ? addForm(ctx) : "";

  return `<div id="msg-${ctx.messageId}" class="space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="text-base font-semibold text-gray-900 dark:text-white">Entities</h3>
      <div class="flex items-center gap-2">
        <button hx-post="/sessions/${ctx.sessionId}/interact"
                hx-vals='${attrJson({ messageId: ctx.messageId, action: addOpen ? "cancel-add" : "add" })}'
                hx-target="#msg-${ctx.messageId}"
                hx-swap="outerHTML"
                class="px-3 py-1.5 text-xs font-medium rounded-lg ${addOpen ? "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300" : "bg-blue-600 hover:bg-blue-500 text-white"}">
          ${addOpen ? "Cancel" : "+ Add Entity"}
        </button>
        <a href="/sessions/${ctx.sessionId}/entity-csv/${ctx.messageId}"
           class="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline">CSV</a>
        <a href="/sessions/${ctx.sessionId}/entity-report/${ctx.messageId}"
           target="_blank"
           class="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline">Report</a>
      </div>
    </div>

    ${addSection}

    ${entities.length === 0 && !addOpen
      ? `<p class="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No entities yet. Click <strong>+ Add Entity</strong> to create one.</p>`
      : `<div class="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <th class="py-2 px-3 text-left font-semibold text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Code</th>
            <th class="py-2 px-3 text-left font-semibold text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Name</th>
            <th class="py-2 px-3 text-center font-semibold text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Primary</th>
            <th class="py-2 px-3 text-center font-semibold text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Active</th>
            <th class="py-2 px-3 text-right font-semibold text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`}
  </div>`;
});

function viewRow(e: any, ctx: TemplateContext): string {
  return `<tr class="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
    <td class="py-2 px-3 font-mono text-sm">${esc(e.code || "")}</td>
    <td class="py-2 px-3 text-sm">${esc(e.name || "")}</td>
    <td class="py-2 px-3 text-center">${e.is_primary ? checkSvg() : ""}</td>
    <td class="py-2 px-3 text-center">${e.active !== false ? checkSvg() : ""}</td>
    <td class="py-2 px-3 text-right whitespace-nowrap">
      <button hx-post="/sessions/${ctx.sessionId}/interact"
              hx-vals='${attrJson({ messageId: ctx.messageId, action: "edit", id: e.id })}'
              hx-target="#msg-${ctx.messageId}"
              hx-swap="outerHTML"
              class="inline px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded">Edit</button>
      <button hx-post="/sessions/${ctx.sessionId}/interact"
              hx-vals='${attrJson({ messageId: ctx.messageId, action: "delete", id: e.id })}'
              hx-target="#msg-${ctx.messageId}"
              hx-swap="outerHTML"
              class="inline px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">Delete</button>
    </td>
  </tr>`;
}

function editRow(e: any, ctx: TemplateContext): string {
  const isPrimary = e.is_primary ? "true" : "false";
  const isActive = e.active !== false ? "true" : "false";
  return `<tr class="border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
    <td class="py-2 px-3"><span class="font-mono text-sm">${esc(e.code || "")}</span></td>
    <td class="py-2 px-3">
      <input name="name" value="${esc(e.name || "")}" placeholder="Entity name"
             class="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500">
    </td>
    <td class="py-2 px-3 text-center">
      <input type="hidden" name="isPrimary" value="false">
      <input type="checkbox" name="isPrimary" value="true" ${e.is_primary ? "checked" : ""}
             class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500">
    </td>
    <td class="py-2 px-3 text-center">
      <input type="hidden" name="active" value="false">
      <input type="checkbox" name="active" value="true" ${e.active !== false ? "checked" : ""}
             class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500">
    </td>
    <td class="py-2 px-3 text-right whitespace-nowrap">
      <button hx-post="/sessions/${ctx.sessionId}/interact"
              hx-vals='${attrJson({ messageId: ctx.messageId, action: "edit-save", id: e.id })}'
              hx-include="closest tr"
              hx-target="#msg-${ctx.messageId}"
              hx-swap="outerHTML"
              class="inline px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded">Save</button>
      <button hx-post="/sessions/${ctx.sessionId}/interact"
              hx-vals='${attrJson({ messageId: ctx.messageId, action: "cancel-edit" })}'
              hx-target="#msg-${ctx.messageId}"
              hx-swap="outerHTML"
              class="inline px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">Cancel</button>
    </td>
  </tr>`;
}

function addForm(ctx: TemplateContext): string {
  return `<form class="border border-blue-300 dark:border-blue-700 rounded-lg p-3 bg-blue-50 dark:bg-blue-900/20"
        hx-post="/sessions/${ctx.sessionId}/interact"
        hx-target="#msg-${ctx.messageId}"
        hx-swap="outerHTML">
    <input type="hidden" name="messageId" value="${ctx.messageId}">
    <input type="hidden" name="action" value="add-save">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Code</label>
        <input name="code" placeholder="e.g. 100" required
               class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500">
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
        <input name="name" placeholder="e.g. Corp A" required
               class="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500">
      </div>
    </div>
    <div class="flex items-center gap-4 mb-3">
      <label class="flex items-center gap-1.5 text-xs">
        <input type="hidden" name="isPrimary" value="false">
        <input type="checkbox" name="isPrimary" value="true"
               class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500">
        Primary entity
      </label>
    </div>
    <div class="flex items-center gap-2">
      <button type="submit"
              class="px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-500 rounded-lg">Create</button>
      <button type="button"
              hx-post="/sessions/${ctx.sessionId}/interact"
              hx-vals='${attrJson({ messageId: ctx.messageId, action: "cancel-add" })}'
              hx-target="#msg-${ctx.messageId}"
              hx-swap="outerHTML"
              class="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">Cancel</button>
    </div>
  </form>`;
}

function checkSvg(): string {
  return `<svg class="w-4 h-4 inline text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attrJson(obj: any): string {
  return esc(JSON.stringify(obj));
}
