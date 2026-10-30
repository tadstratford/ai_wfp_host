import type { TableInfo, QueryResult } from "@backend/core/admin/dbInspector";

const inputCls =
  "w-full rounded-xl border border-ink/[0.12] bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-400 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition font-mono";

export function DbInspectorPage({ tables, path }: { tables: TableInfo[]; path: string }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Database Inspector — Workflow People</title>
        <link rel="icon" type="image/svg+xml" href="/public/img/favicon.svg" />
        <link rel="stylesheet" href="/public/css/tailwind.css" />
        <script src="https://unpkg.com/htmx.org@2.0.4"></script>
      </head>
      <body class="min-h-screen bg-[#F3F5F9] text-ink p-6">
        <div class="max-w-5xl mx-auto">
          <div class="flex items-center justify-between mb-6">
            <div>
              <h1 class="text-xl font-bold tracking-tight text-ink">Database Inspector</h1>
              <p class="text-sm text-ink-500 mt-1 font-mono">{path}</p>
            </div>
            <a href="/app" class="text-sm font-semibold text-brand-600 hover:text-brand-700 no-underline">← Back to app</a>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section class="bg-white border border-ink/[0.08] rounded-xl p-5">
              <h2 class="text-sm font-semibold text-ink-700 mb-3">Tables</h2>
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-xs text-ink-400 border-b border-ink/[0.08]">
                    <th class="py-2 font-semibold">table</th>
                    <th class="py-2 font-semibold text-right">rows</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map((t) => (
                    <tr class="border-b border-ink/[0.04]">
                      <td class="py-1.5 font-mono text-xs">{t.name}</td>
                      <td class="py-1.5 text-right font-mono text-xs text-ink-500">{t.rowCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section class="bg-white border border-ink/[0.08] rounded-xl p-5">
              <h2 class="text-sm font-semibold text-ink-700 mb-3">Query (read-only)</h2>
              <form hx-post="/admin/db/query" hx-target="#db-results" hx-swap="innerHTML">
                <textarea name="sql" rows={6} placeholder="SELECT * FROM admin_users LIMIT 10;" class={inputCls}></textarea>
                <button
                  type="submit"
                  class="mt-3 rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition"
                >
                  Run
                </button>
              </form>
              <div class="mt-3 flex flex-wrap gap-2">
                {[
                  "SELECT * FROM admin_users LIMIT 20",
                  "SELECT user_id, source, model, cost_usd, created_at FROM llm_usage ORDER BY created_at DESC LIMIT 20",
                  "SELECT action, user_email, created_at FROM user_activity ORDER BY created_at DESC LIMIT 20",
                  "SELECT workspace_id, name, updated_at, length(enc_metadata) AS meta_bytes FROM workspaces",
                ].map((q) => (
                  <button
                    type="button"
                    class="text-xs font-mono rounded-lg border border-ink/[0.12] px-2 py-1 text-ink-500 hover:bg-ink/[0.04] transition"
                    hx-on--click={`document.querySelector('textarea[name=sql]').value=${JSON.stringify(q)}`}
                  >
                    {q.split(" ").slice(0, 3).join(" ")}…
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div id="db-results" class="mt-6"></div>
        </div>
      </body>
    </html>
  );
}

export function DbResultFragment({ result }: { result: QueryResult }) {
  if (!result.ok) {
    return (
      <div class="rounded-lg border border-coral-200 bg-coral-50 text-coral-600 px-4 py-3 text-sm">
        <div class="font-semibold mb-1">Query failed</div>
        <div class="font-mono text-xs whitespace-pre-wrap">{result.error}</div>
      </div>
    );
  }

  if (result.columns.length === 0) {
    return (
      <div class="rounded-lg border border-ink/[0.08] bg-white px-4 py-3 text-sm text-ink-500">
        Query returned no columns.
      </div>
    );
  }

  return (
    <div class="bg-white border border-ink/[0.08] rounded-xl overflow-hidden">
      <div class="px-4 py-2 text-xs font-semibold text-ink-400 border-b border-ink/[0.08]">
        {result.rowCount} row{result.rowCount === 1 ? "" : "s"}
        {result.rowCount > result.rows.length ? ` (showing first ${result.rows.length})` : ""}
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-ink-400 bg-ink/[0.02]">
              {result.columns.map((c) => (
                <th class="px-3 py-2 font-semibold whitespace-nowrap font-mono">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr class="border-t border-ink/[0.04]">
                {row.map((cell) => (
                  <td class="px-3 py-1.5 font-mono text-xs text-ink-600 align-top whitespace-pre-wrap max-w-xs break-all">
                    {cell === null ? <span class="text-ink-300">NULL</span> : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
