// Copy an item in from another .wfp file. Supports three kinds:
//   - workflow (plus its referenced custom tools)
//   - rule
//   - data
//
// Flow:
//   1. A "Copy …" button (local edition) opens a file picker carrying `kind`.
//   2. POST /app/copy-from-file/upload parses the file (prompting for a
//      passphrase if encrypted) and stashes the parsed WfpFile.
//   3. A modal lists the file's items of that kind; each shows a Copy action.
//   4. POST /app/copy-from-file/:kind/:id imports it and refreshes the page.

import { Context } from "hono";
import type { User } from "@backend/types";
import type { DataEntry, Rule, WfpFile, Workflow } from "wfp-format";
import { importWorkflowFromFile } from "@backend/core/workflow";
import { importRuleFromFile, importDataFromFile } from "@backend/core/workspace/importFromFile";
import { decryptWorkspace, isEncryptedEnvelope } from "@backend/core/workspace/crypto";
import { getWorkspaceSession } from "@backend/core/workspace/workspaceSessionStore";
import { workspacePageView } from "./workspacePanel";
import { rulesPanelView } from "../rules/rulesPanel";
import { dataPanelView } from "../data/dataPanel";

export type CopyKind = "workflow" | "rule" | "data";

const MODAL_ID = "copy-from-file-modal";

const KIND_LABEL: Record<CopyKind, string> = {
  workflow: "workflow",
  rule: "rule",
  data: "data",
};

// ── Stash (single slot per user, TTL 5 min) ────────────────────────────────

interface ParsedSource {
  wfp: WfpFile;
  kind: CopyKind;
  createdAt: number;
}
interface PendingEncrypted {
  content: string;
  filename: string;
  kind: CopyKind;
  createdAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const parsedSources = new Map<string, ParsedSource>();
const pendingEncrypted = new Map<string, PendingEncrypted>();

function stashSource(userId: string, wfp: WfpFile, kind: CopyKind): void {
  parsedSources.set(userId, { wfp, kind, createdAt: Date.now() });
}
function takeSource(userId: string): ParsedSource | null {
  const s = parsedSources.get(userId);
  if (!s) return null;
  if (Date.now() - s.createdAt > TTL_MS) {
    parsedSources.delete(userId);
    return null;
  }
  parsedSources.delete(userId);
  return s;
}
function stashEncrypted(userId: string, content: string, filename: string, kind: CopyKind): void {
  pendingEncrypted.set(userId, { content, filename, kind, createdAt: Date.now() });
}
function takeEncrypted(userId: string): PendingEncrypted | null {
  const e = pendingEncrypted.get(userId);
  if (!e) return null;
  if (Date.now() - e.createdAt > TTL_MS) {
    pendingEncrypted.delete(userId);
    return null;
  }
  pendingEncrypted.delete(userId);
  return e;
}

// ── Modal shell ────────────────────────────────────────────────────────────

function ModalShell({ title, children }: { title: string; children: any }) {
  return (
    <div id={MODAL_ID} class="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
      <div class="bg-white dark:bg-ink-900 rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between px-5 py-4 border-b border-ink/[0.07] dark:border-white/[0.07]">
          <h2 class="text-base font-extrabold tracking-tight text-ink dark:text-white">{title}</h2>
          <button
            id={`cancel-${MODAL_ID}`}
            class="p-1 text-ink-400 hover:text-ink-600 dark:hover:text-white rounded"
            aria-label="Close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div class="mb-3 p-3 text-sm bg-coral-50 dark:bg-coral-900/30 text-coral-600 dark:text-coral-300 border border-coral-200 dark:border-coral-800 rounded-xl">
      {message}
    </div>
  );
}

const COPY_SVG = "M9 9h10v10H9zM5 5h10v3M5 5v10h3";
const CHECK_SVG = "m4.5 12.75 6 6 9-13.5";

// ── Parsing helpers ────────────────────────────────────────────────────────

function parseWfp(content: string): WfpFile {
  let wfp: WfpFile;
  try {
    wfp = JSON.parse(content) as WfpFile;
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (!Array.isArray(wfp.workflows)) {
    throw new Error("Not a valid .wfp file (missing workflows).");
  }
  return wfp;
}

// ── Copy action button ─────────────────────────────────────────────────────

function CopyAction({ href }: { href: string }) {
  return (
    <button
      type="button"
      hx-post={href}
      hx-target="#main-panel"
      hx-swap="innerHTML"
      hx-on--after-request="document.getElementById('modal-container').innerHTML=''; document.getElementById('modal-container').classList.add('hidden');"
      class="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 transition-colors"
    >
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d={COPY_SVG} />
      </svg>
      Copy
    </button>
  );
}

// ── List modal ─────────────────────────────────────────────────────────────

function renderListModal(userId: string, source: ParsedSource, filename: string) {
  const session = getWorkspaceSession(userId);
  const title = `Copy ${KIND_LABEL[source.kind]} from ${filename}`;

  let body: any = null;
  let count = 0;

  if (source.kind === "workflow") {
    const existingIds = new Set((session?.getWorkflows() ?? []).map((w) => w.id));
    count = (source.wfp.workflows ?? []).length;
    body = (
      <ul class="space-y-2">
        {(source.wfp.workflows ?? []).map((wf: Workflow) => {
          const exists = existingIds.has(wf.id);
          return (
            <li class="flex items-center gap-3 rounded-xl border border-ink/[0.08] dark:border-white/[0.08] px-3 py-2">
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-ink dark:text-white truncate">{wf.name}</div>
                <div class="text-xs text-ink-500">
                  {(wf.nodes ?? []).length} step{(wf.nodes ?? []).length === 1 ? "" : "s"}
                  {wf.type ? ` · ${wf.type}` : ""}
                </div>
              </div>
              {exists ? (
                <span class="inline-flex items-center gap-1 text-xs font-medium text-ink-400 dark:text-ink-500">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d={CHECK_SVG} />
                  </svg>
                  In workspace
                </span>
              ) : (
                <CopyAction href={`/app/copy-from-file/workflow/${encodeURIComponent(wf.id)}`} />
              )}
            </li>
          );
        })}
      </ul>
    );
  } else if (source.kind === "rule") {
    const existingNames = new Set((session?.getRules() ?? []).map((s) => s.name));
    count = (source.wfp.rules ?? []).length;
    body = (
      <ul class="space-y-2">
        {(source.wfp.rules ?? []).map((rule: Rule) => (
          <li class="flex items-center gap-3 rounded-xl border border-ink/[0.08] dark:border-white/[0.08] px-3 py-2">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-ink dark:text-white truncate">{rule.name}</div>
              <div class="text-xs text-ink-500">
                {existingNames.has(rule.name) ? "will be renamed" : ""}
              </div>
            </div>
            <CopyAction href={`/app/copy-from-file/rule/${encodeURIComponent(rule.name)}`} />
          </li>
        ))}
      </ul>
    );
  } else {
    const entries = Object.entries(source.wfp.data ?? {});
    const existingNames = new Set(session?.getDataNames() ?? []);
    count = entries.length;
    body = (
      <ul class="space-y-2">
        {entries.map(([name, entry]: [string, DataEntry]) => (
          <li class="flex items-center gap-3 rounded-xl border border-ink/[0.08] dark:border-white/[0.08] px-3 py-2">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-ink dark:text-white truncate">{name}</div>
              <div class="text-xs text-ink-500">
                {entry.content_type ? entry.content_type : ""}
                {entry.row_count != null ? ` · ${entry.row_count} rows` : ""}
                {existingNames.has(name) ? " · will be renamed" : ""}
              </div>
            </div>
            <CopyAction href={`/app/copy-from-file/data/${encodeURIComponent(name)}`} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ModalShell title={title}>
      {count === 0 ? (
        <p class="text-sm text-ink-500">
          This file has no {KIND_LABEL[source.kind]} to copy.
        </p>
      ) : (
        body
      )}
    </ModalShell>
  );
}

function renderPassphraseModal(filename: string, error?: string) {
  return (
    <ModalShell title={`Unlock ${filename}`}>
      <form hx-post="/app/copy-from-file/decrypt" hx-target="this" hx-swap="outerHTML" class="space-y-4">
        <p class="text-sm text-ink-500">
          This file is encrypted. Enter the secret word used when it was saved.
        </p>
        {error && <ErrorBanner message={error} />}
        <input
          type="password"
          name="secret"
          required
          autofocus
          class="w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] bg-[#F3F5F9] dark:bg-ink-800 text-ink dark:text-white placeholder:text-ink-400 rounded-xl focus:outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:focus:bg-ink-900 dark:focus:ring-brand-900"
        />
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            id={`cancel-${MODAL_ID}-2`}
            class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors"
          >
            Cancel
          </button>
          <button type="submit" class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors">
            Continue
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Handlers ───────────────────────────────────────────────────────────────

function readKind(form: Record<string, unknown>): CopyKind {
  const kind = String(form.kind ?? "");
  return kind === "rule" || kind === "data" ? kind : "workflow";
}

export const copyFromFileUploadHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const form = (await c.req.parseBody()) as Record<string, unknown>;
  const kind = readKind(form);
  const raw = form.file;
  const file = Array.isArray(raw) ? raw[0] : raw;

  if (!file || typeof file === "string") {
    return c.html(
      <ModalShell title={`Copy ${KIND_LABEL[kind]}`}>
        <ErrorBanner message="No file selected." />
      </ModalShell>,
    );
  }

  const content = await (file as File).text();
  const filename = (file as File).name || "workspace.wfp";

  if (isEncryptedEnvelope(content)) {
    stashEncrypted(user.userId, content, filename, kind);
    return c.html(renderPassphraseModal(filename));
  }

  try {
    const wfp = parseWfp(content);
    stashSource(user.userId, wfp, kind);
    return c.html(renderListModal(user.userId, { wfp, kind, createdAt: Date.now() }, filename));
  } catch (err) {
    return c.html(
      <ModalShell title={`Copy ${KIND_LABEL[kind]}`}>
        <ErrorBanner message={err instanceof Error ? err.message : "Failed to read file."} />
      </ModalShell>,
    );
  }
};

export const copyFromFileDecryptHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const form = await c.req.parseBody();
  const secret = String(form.secret ?? "");

  const upload = takeEncrypted(user.userId);
  if (!upload) {
    return c.html(
      <ModalShell title="Copy">
        <ErrorBanner message="Upload expired. Please choose the file again." />
      </ModalShell>,
    );
  }

  let plaintext: string;
  try {
    plaintext = decryptWorkspace(upload.content, secret);
  } catch {
    stashEncrypted(user.userId, upload.content, upload.filename, upload.kind);
    return c.html(renderPassphraseModal(upload.filename, "Incorrect secret. Try again."));
  }

  try {
    const wfp = parseWfp(plaintext);
    stashSource(user.userId, wfp, upload.kind);
    return c.html(renderListModal(user.userId, { wfp, kind: upload.kind, createdAt: Date.now() }, upload.filename));
  } catch (err) {
    return c.html(
      <ModalShell title={`Copy ${KIND_LABEL[upload.kind]}`}>
        <ErrorBanner message={err instanceof Error ? err.message : "Failed to read file."} />
      </ModalShell>,
    );
  }
};

export const copyFromFileImportWorkflowHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.text("");

  const workflowId = c.req.param("id");
  const source = takeSource(user.userId);
  if (!source) {
    return c.html(
      <ModalShell title="Copy workflow">
        <ErrorBanner message="Upload expired. Please choose the file again." />
      </ModalShell>,
    );
  }

  const workflow = (source.wfp.workflows ?? []).find((w) => w.id === workflowId);
  if (!workflow) {
    return c.html(
      <ModalShell title="Copy workflow">
        <ErrorBanner message="That workflow is no longer in the chosen file." />
      </ModalShell>,
    );
  }

  importWorkflowFromFile(databaseId, workflow, source.wfp.tools ?? []);
  return workspacePageView(c);
};

export const copyFromFileImportRuleHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.text("");

  const name = decodeURIComponent(c.req.param("id"));
  const source = takeSource(user.userId);
  if (!source) {
    return c.html(
      <ModalShell title="Copy rule">
        <ErrorBanner message="Upload expired. Please choose the file again." />
      </ModalShell>,
    );
  }

  const rule = (source.wfp.rules ?? []).find((s) => s.name === name);
  if (!rule) {
    return c.html(
      <ModalShell title="Copy rule">
        <ErrorBanner message="That rule is no longer in the chosen file." />
      </ModalShell>,
    );
  }

  importRuleFromFile(databaseId, rule);
  return rulesPanelView(c);
};

export const copyFromFileImportDataHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.text("");

  const name = decodeURIComponent(c.req.param("id"));
  const source = takeSource(user.userId);
  if (!source) {
    return c.html(
      <ModalShell title="Copy data">
        <ErrorBanner message="Upload expired. Please choose the file again." />
      </ModalShell>,
    );
  }

  const entry = (source.wfp.data ?? {})[name];
  if (!entry) {
    return c.html(
      <ModalShell title="Copy data">
        <ErrorBanner message="That data is no longer in the chosen file." />
      </ModalShell>,
    );
  }

  importDataFromFile(databaseId, name, entry);
  return dataPanelView(c);
};
