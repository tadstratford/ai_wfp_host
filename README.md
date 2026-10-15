# WorkflowPeople

Open-source accounting & finance workflow automation. An AI chat orchestrator
that routes through a "System One" classifier, calls tools over
[Model Context Protocol](https://modelcontextprotocol.io) (MCP), runs custom
workflows, and stores everything in a portable `.wfp` document the user owns.

## What it does

- **AI chat** (`vers_8` orchestrator) — deterministic gates → Jev classifier
  routing → a read-only fast path, a composed node-plan, or an LLM tool-calling
  loop. Entity names are privacy-masked (`<eN>`) before they leave the machine
  and restored after.
- **Workflows** — CRUD, a visual graph editor, a linear execution engine with
  pause/resume, per-node approval/budget/email settings, versioning, changelog,
  and a plan → wire → test build pipeline. A chat session can be saved as a
  reusable, parameterized workflow.
- **MCP tool-calling** — a built-in aggregator exposes native and MCP-server
  tools to both chat and workflow execution (via a single `run_MCP` bridge).
- **Capabilities** (each co-locates manifest + tools + skills): `data`,
  `emails`, `judge`, `metadata`, `planning`, `plans`, `qbo`, `rules`,
  `skill-activation`, `todos`, `workflows`.
- **QuickBooks Online** — live OAuth integration (tokens scoped per workspace)
  plus parsing of QBO exports (general ledger, journal, chart of accounts) into
  normalized data tables.
- **Data** — CSV/XLSX ingest, a normalize pipeline, tabular data, aggregation,
  and deterministic drill-down HTML reports.
- **Email** — inbound inbox (Resend webhook) with a headless shadow agent, plus
  outbound sends.
- **Billing & credits** — `BILLING_MODE` (`credits` / `admin_pays` / `none`),
  per-user usage tracking, and rate limiting.
- **`.wfp` document** — a JSON file format (types in `src/types/`), encrypted at
  rest with AES-GCM, portable and user-owned.

## Quick Start

```bash
bun install
cp .env.example .env   # fill in the vars for your edition (see below)
bun run dev            # http://localhost:3000
```

**Prerequisites:** [Bun](https://bun.sh) 1.x (pinned to 1.3.10 via `.bun-version`).
What else you need depends on the edition:

- `EDITION=hosted` (default) — a Supabase project + a Classifier key + an LLM key.
- `EDITION=local` — no database; just an LLM key (bring your own) + `APP_SECRET`.

## Tech Stack

| Layer                     | Technology                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Runtime                   | [Bun](https://bun.sh)                                                                    |
| HTTP framework            | [Hono](https://hono.dev) (JSX server-rendering)                                          |
| Frontend                  | HTMX + Tailwind CSS (no client-side framework)                                           |
| AI / LLM                  | Provider-agnostic dispatcher (Anthropic, DeepSeek, OpenRouter; OpenAI/Google/Together models via OpenRouter) |
| Classifier ("System One") | Jev via OpenRouter decisions endpoint                                                    |
| Tool protocol             | [Model Context Protocol](https://modelcontextprotocol.io)                                |
| Storage                   | Supabase (hosted/enterprise) or local `.wfp` files (local)                               |
| Document format           | `.wfp` (JSON — encrypted at rest)                                                        |

## Project Structure

```
src/
├── server/        HTTP entry point, auth, middleware, admin, streaming
├── ui/            Server-rendered JSX pages (HTMX), all route handlers
├── chat/          AI chat orchestrator (vers_8; legacy vers_5), prompt templates
├── capabilities/  Curated capabilities (data, emails, judge, metadata, planning,
│                  plans, qbo, rules, skill-activation, todos, workflows)
├── core/          Shared core: tool registry (core/tools), skills loader (core/skills)
├── mcp/           MCP aggregator + built-in servers
├── workflow/      Workflow CRUD, execution engine, build pipeline, native tools (run/)
├── workspace/     .wfp document model, WorkspaceSession, lifecycle, store
├── shared/        Cross-cutting: LLM clients, billing, crypto, dataRoot, wfp-api,
│                  typesafe (Jev classifier)
├── data/          Data ingest/normalize (CSV/XLSX, QBO parsing)
├── rules/         Rule loader/store
└── types/         The .wfp document format types (imported as `wfp-format`)
```

Each module has its own `README.md` for file-level detail.

## Key Concepts

- **`.wfp` file** — open document format for workspaces. Contains workflows, data,
  knowledge, skills, sessions, todos. Types live in `src/types/` (aliased as
  `wfp-format` in `tsconfig.json`). Encrypted at rest with AES-GCM.
- **WorkspaceSession** — in-memory decrypted container; all state mutations go
  through it.
- **Chat v8** — deterministic gates + Classifier routing, then a fast path or an
  LLM tool-calling loop.
- **MCP Aggregator** — built-in servers expose tools to the LLM and workflow
  executor. See [`docs/mcp-servers.md`](docs/mcp-servers.md).
- **Capabilities** — a consolidated, self-registering view of the tool surface.
  Each capability co-locates its manifest, tools, and skills.
- **Privacy masking** — entity names are replaced with `<eN>` tokens before LLM
  calls and restored after.

## Editions

The `EDITION` environment variable selects the deployment mode. There is no
compile-time fork — the same binary serves any edition. **Defaults to `hosted`.**

|                   | `hosted` (default)     | `enterprise`               | `local`                    |
| ----------------- | ---------------------- | -------------------------- | -------------------------- |
| Workspace storage | Supabase               | Supabase                   | Local `.wfp` files         |
| Auth              | Google OAuth           | password (`AUTH=password`) | none (single user)         |
| Users             | multi-user             | multi-user (firm/clients)  | single user (`ADMIN_USER`) |
| LLM key           | server key or per-user | admin `.env` key           | bring your own (BYO)       |
| Billing           | `credits`              | `admin_pays`               | `none` (BYO)               |

Billing is covered in
[`docs/credits-and-billing.md`](docs/credits-and-billing.md); the
layer-by-edition differences are mapped in
[`docs/architecture.md`](docs/architecture.md).

## Configuration

Copy `.env.example` to `.env`. Requirements vary by edition:

- **`hosted` / `enterprise`** — `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `APP_SECRET`,
  plus a Classifier key and an LLM key.
- **`local`** — `APP_SECRET`, `ADMIN_USER`, and your own LLM key (e.g.
  `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, or `LLM_API_PROVIDER`/`LLM_API_KEY`).

**Password auth** (`AUTH=password`, the `enterprise` default): set `ADMIN_USER` +
`ADMIN_PASSWORD`; the password is hashed into the admin account on first startup.
Reset a lost password with:

```bash
bun run scripts/reset-password.ts you@example.com
```

Users can also bring their own LLM API keys per provider via the Settings panel
(model/provider picker).

## Development

```bash
bun run dev            # hot-reload server (EDITION=hosted, the default)
bun run dev:local      # EDITION=local  (single-user, file-only)
bun run dev:enterprise # EDITION=enterprise
bun run typecheck      # TypeScript checking
bun run build          # compile to standalone executable (workflowpeople)
```

Module guides: `src/server/README.md` · `src/ui/README.md` · `src/chat/README.md`
· `src/workflow/README.md` · `src/mcp/README.md` · `src/workspace/README.md` ·
`src/shared/README.md` · `src/core/tools/README.md`.

## Documentation

| Topic                                        | Doc                                                          |
| -------------------------------------------- | ------------------------------------------------------------ |
| Architecture (modules, layers, request flow) | [`docs/architecture.md`](docs/architecture.md)               |
| MCP servers                                  | [`docs/mcp-servers.md`](docs/mcp-servers.md)                 |
| Usage, credits & billing                     | [`docs/credits-and-billing.md`](docs/credits-and-billing.md) |

## License

MIT — see [`LICENSE`](LICENSE). This includes the `.wfp` document format types in
`src/types/`.
