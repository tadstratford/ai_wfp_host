# Shared

> Last updated: 2026-09-27

Cross-cutting utilities, types, and adapters. No business logic — only infrastructure shared across all modules.

## Subdirectories

| Directory | Purpose |
|---|---|
| `crypto/` | Encryption utilities — workspace encryption, secret/key encryption (AES-GCM). |
| `email/` | Email sending via Resend (contact, share, inbound-reject, generic). |
| `llm/` | LLM layer — provider adapters, billing/credit, metering, masking. |
| `logging/` | Structured error logging (`errorLogger.ts`). |
| `types/` | Shared type definitions (user, auth, workflow, session, tool, forms, …). |
| `typesafe/` | Classifier ("System One") client — Jev over OpenRouter decisions (`judge`, `builders`, `cache`, `pool`). |
| `utils/` | `markdownToHtml.ts`, `shortId.ts`. |
| `wfp-api/` | The WFP API surface exposed to custom tool code (`api.*`). |

## Top-level files

| File | Purpose |
|---|---|
| `dataRoot.ts` | Base directory for all app-written files (`DATA_DIR` → `EDITION`-aware default). |
| `edition.ts` | The edition switch + presets (`hosted` / `enterprise` / `local`). |
| `navItems.ts` | Shell nav section keys. |
| `skillGroups.ts` | Skill group keys. |

## `llm/` (see also `docs/credits-and-billing.md`)

| File | Purpose |
|---|---|
| `providers/` | Raw-fetch provider adapters (`anthropic`, `deepseek`, `openRouter`) + `callProvider()` dispatcher in `index.ts`. |
| `llmCall.ts` | Rate-limited wrapper around `callLLM()`. |
| `llm-client.ts` | `callLLM()` — generic client over the adapters. |
| `billing.ts` | Billing seam (`BILLING_MODE`: `credits` / `admin_pays` / `none`). |
| `credit.ts` | Credit gate + per-call margin. |
| `usageTracker.ts` | Buffered usage metering → `llm_usage`. |
| `activityTracker.ts` | Buffered user activity → `user_activity`. |
| `routeModel.ts` | Model-routing seam (stub — implementation planned). |
| `privacyMask.ts` | PII masking (`<eN>` tokens before calls, restored after). |
| `rateLimiter.ts` | Per-hour rate limiting. |
| `llm-logger.ts` | Filesystem debug logger (`logs/LLM_API_calls/`). |
| `llm-providers.json` | Provider/model catalog (source of truth for the model picker). |
| `types.ts` | Provider request/response types. |
| `supabaseUsageQuery.ts` | Usage analytics queries. |
| `together_llm_enhanced.ts`, `visionAPI.ts` | Legacy clients — superseded by `providers/`. |

## `typesafe/`

| File | Purpose |
|---|---|
| `judge.ts` | `judgeRows()` — batched Jev judgment over data rows. |
| `builders.ts` | Typed question/state builders. |
| `openRouter.ts` | OpenRouter decisions-endpoint client. |
| `pool.ts`, `cache.ts` | Concurrency + caching. |
| `types.ts` | Judge types. |

## Related modules

- Imported by virtually every module in `src/`.
- `src/shared/llm/` powers both chat orchestration and workflow tool execution.
- `src/shared/wfp-api/` defines the API surface used by custom tools.
