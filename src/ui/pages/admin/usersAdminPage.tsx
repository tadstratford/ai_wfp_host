import type { UserRow, AdminResult } from "@backend/core/admin/userAdmin";

const inputCls =
  "w-full rounded-xl border border-ink/[0.12] bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-400 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition";
const labelCls = "block text-xs font-semibold text-ink-500 mb-1";
const submitCls =
  "rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition";

function formatCredit(n: number): string {
  return `$${n.toFixed(2)}`;
}

function UsersTable({ users }: { users: UserRow[] }) {
  return (
    <div class="bg-white border border-ink/[0.08] rounded-xl overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-ink-400 bg-ink/[0.02]">
            <th class="px-3 py-2 font-semibold">email</th>
            <th class="px-3 py-2 font-semibold">name</th>
            <th class="px-3 py-2 font-semibold text-center">admin</th>
            <th class="px-3 py-2 font-semibold text-center">password</th>
            <th class="px-3 py-2 font-semibold text-right">credits</th>
            <th class="px-3 py-2 font-semibold">created</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr class="border-t border-ink/[0.04]">
              <td class="px-3 py-2 font-mono text-xs text-ink-700">{u.email}</td>
              <td class="px-3 py-2 text-ink-600">{u.name}</td>
              <td class="px-3 py-2 text-center text-ink-500">{u.isAdmin ? "✓" : ""}</td>
              <td class="px-3 py-2 text-center text-ink-500">{u.hasPassword ? "set" : "—"}</td>
              <td class="px-3 py-2 text-right font-mono text-xs text-ink-600">{formatCredit(u.creditBalanceUsd)}</td>
              <td class="px-3 py-2 font-mono text-xs text-ink-400">
                {u.createdAt ? u.createdAt.slice(0, 10) : "—"}
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr class="border-t border-ink/[0.04]">
              <td colspan={6} class="px-3 py-4 text-sm text-ink-400 text-center">
                No users.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusBanner({ result }: { result: AdminResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <div class="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-3 text-sm font-semibold">
      Done.
    </div>
  ) : (
    <div class="rounded-lg border border-coral-200 bg-coral-50 text-coral-600 px-4 py-3 text-sm">
      <div class="font-semibold mb-1">Failed</div>
      <div class="text-xs whitespace-pre-wrap">{result.error}</div>
    </div>
  );
}

function UsersContent({ users, authMode }: { users: UserRow[]; authMode: string }) {
  return (
    <>
      <section>
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold text-ink-700">Users ({users.length})</h2>
        </div>
        <UsersTable users={users} />
      </section>

      {authMode === "password" && (
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <section class="bg-white border border-ink/[0.08] rounded-xl p-5">
            <h2 class="text-sm font-semibold text-ink-700 mb-3">Create user</h2>
            <form hx-post="/admin/users/create" hx-target="#users-result" hx-swap="innerHTML" class="space-y-3">
              <div>
                <label class={labelCls}>Email</label>
                <input name="email" type="email" required placeholder="you@example.com" class={inputCls} />
              </div>
              <div>
                <label class={labelCls}>Name</label>
                <input name="name" type="text" placeholder="defaults to email prefix" class={inputCls} />
              </div>
              <div>
                <label class={labelCls}>Password (min 8 chars)</label>
                <input name="password" type="password" required minlength={8} class={inputCls} />
              </div>
              <div>
                <label class={labelCls}>Credits (USD)</label>
                <input name="credit" type="number" step="0.01" min="0" value="0" class={inputCls} />
              </div>
              <label class="flex items-center gap-2 text-sm text-ink-600">
                <input name="admin" type="checkbox" class="rounded border-ink/[0.2]" />
                Admin user
              </label>
              <button type="submit" class={submitCls}>
                Create
              </button>
            </form>
          </section>

          <section class="bg-white border border-ink/[0.08] rounded-xl p-5">
            <h2 class="text-sm font-semibold text-ink-700 mb-3">Reset password</h2>
            <form hx-post="/admin/users/reset-password" hx-target="#users-result" hx-swap="innerHTML" class="space-y-3">
              <div>
                <label class={labelCls}>User</label>
                <select name="email" required class={inputCls}>
                  <option value="" disabled selected>
                    Select a user…
                  </option>
                  {users.map((u) => (
                    <option value={u.email}>{u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label class={labelCls}>New password (min 8 chars)</label>
                <input name="password" type="password" required minlength={8} class={inputCls} />
              </div>
              <button type="submit" class={submitCls}>
                Reset
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

export function UsersAdminPage({ users, authMode }: { users: UserRow[]; authMode: string }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Users — Workflow People</title>
        <link rel="icon" type="image/svg+xml" href="/public/img/favicon.svg" />
        <link rel="stylesheet" href="/public/css/tailwind.css" />
        <script src="https://unpkg.com/htmx.org@2.0.4"></script>
      </head>
      <body class="min-h-screen bg-[#F3F5F9] text-ink p-6">
        <div class="max-w-5xl mx-auto">
          <div class="flex items-center justify-between mb-6">
            <div>
              <h1 class="text-xl font-bold tracking-tight text-ink">Users</h1>
              <p class="text-sm text-ink-500 mt-1">Create accounts and reset passwords on this server.</p>
            </div>
            <div class="flex items-center gap-4 text-sm font-semibold">
              <a href="/admin/db" class="text-ink-500 hover:text-ink-700 no-underline">Database</a>
              <a href="/app" class="text-brand-600 hover:text-brand-700 no-underline">← Back to app</a>
            </div>
          </div>

          <div id="users-result">
            <UsersContent users={users} authMode={authMode} />
          </div>
        </div>
      </body>
    </html>
  );
}

export function UsersResultFragment({
  users,
  result,
  authMode,
}: {
  users: UserRow[];
  result: AdminResult;
  authMode: string;
}) {
  return (
    <>
      <div class="mb-4">
        <StatusBanner result={result} />
      </div>
      <UsersContent users={users} authMode={authMode} />
    </>
  );
}
