# Page-workflows & the element catalog

A **page-workflow** is an ordinary workflow that also acts as a *page* in the
workspace. Set its top-level `group` (e.g. `"Accounting"`) and it appears in the
left-nav under that section; clicking it **runs the workflow** ephemerally and
renders its messages into the main panel. There is no separate "page" type — a page
is just a workflow whose UI is written with `api.addMessage(...)`.

Use a page-workflow when the request asks for an app screen ("a chart-of-accounts
page", "the accounting app"). Use a plain (ungrouped) workflow for a one-off
report or batch process.

## Rendering UI from a tool: `api.addMessage`

A tool draws the page by calling `api.addMessage(...)`. Each call appends one block
to the panel. Most pages are a few `addMessage` calls in a single tool. The common
shapes:

- **Prose / headings** — `api.addMessage({ markdown: "## Chart of Accounts\nReview and adjust below." })`
- **A computed table** — `api.addMessage({ table: { columns: [...], rows: [...] } })`
- **A built report** — `api.addMessage({ html })` (build the HTML deterministically in
  tool code; never ask the LLM to emit report HTML).
- **A reusable widget** — `api.addMessage({ element: "gl-accounts", mode: "edit" })`
  (see the element catalog below).

`addMessage` takes **one object**. `element` is the **string name** of a catalog
widget; `mode` and `elementParams` are its siblings:

```js
// Show the live chart of accounts, editable. One line.
api.addMessage({ element: "gl-accounts", mode: "edit" });
```

The active workspace is resolved server-side — a tool never passes ids or builds a
URL. The host renders an HTMX loader for the element; the element owns its own
view/edit/save behavior.

## Element catalog

Elements are reusable sub-app widgets that render their own interactive HTML and
persist their own edits to the **workspace** (the system of record), not back to the
run. Mount one with `api.addMessage({ element, mode, elementParams })`.

| element | modes | what it does |
|---------|-------|--------------|
| `gl-accounts` | `view` (default), `edit` | The workspace chart of accounts. `view` is a read-only table with an "Adjust" button; `edit` lets the user rename accounts and change types, and **Save persists to the workspace GL** (`extensions.gl`). |

A page that lets the user maintain their chart of accounts is therefore one tool with
one line: `api.addMessage({ element: "gl-accounts", mode: "edit" })`. No data
plumbing, no download — the element reads and writes the workspace itself.

## Reading workspace data in a page tool

Page tools read the system of record through the same `api.*` surface as any tool:

- `api.gl?.accounts()`, `api.gl?.trialBalance({ asOf })`, `api.gl?.journals()` —
  the general ledger (present when the Accounting module is enabled).
- `api.fpa?.*` — Planning (present when that module is enabled).
- `api.getData("<name>")` — a loaded workspace data file.

Guard the optional namespaces (`if (!api.gl) { api.addMessage({ markdown: "Accounting isn't enabled." }); return; }`).

## Two kinds of "save"

1. **Element edit → workspace.** When a user edits inside an element (e.g. renames an
   account in `gl-accounts` and clicks Save), the element writes straight to the
   workspace. Nothing goes back to the run; later steps/pages read the new value via
   `api.gl`. This is the normal case for a maintenance page.
2. **Pause for input → parameter.** Only when a flow must *block* on a typed value
   (a wizard) use the built-in pause/resume form; the value comes back as a
   parameter the next tool reads with `api.getParameter(...)`.

## Authoring checklist

- Set `group` on the plan to the section name (e.g. `"Accounting"`).
- Keep the page to one (or few) deterministic tool(s) calling `api.addMessage(...)`.
- Prefer an existing **element** over re-emitting editor HTML.
- Read live state through `api.gl` / `api.fpa` / `api.getData`, not hard-coded data.
- A page-workflow usually has **no `chat_download` node** — it renders in the panel
  rather than producing a file.
