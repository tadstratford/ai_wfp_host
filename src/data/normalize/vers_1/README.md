# Data Normalization — vers_1

Non-conforming tabular input (`.xlsx`, `.xls`, `.csv`, `.tsv`) is reduced to a set of
**normalized, related tables** (JSON arrays with foreign keys) at load time, so chat,
sessions, and workflow custom tools never have to reason about a file's raw shape.

## Principles

- **Reports are views, not storage.** Output is normalized tables; any report is rendered from them.
- **Lossless capture first.** Every input is captured as `json_cells` (the raw material) before interpretation.
- **Judgment (Classifier / Jev) is separated from assembly (deterministic code).** Jev classifies; code assembles.
- **Tunable, not rewritten.** Use-case differences are `NormalizeConfig` presets, not code changes.
- **Load-time only.** Downstream reads normalized tables; raw cells are surfaced only on explicit request.

## Scope

| Input | v1 | Notes |
|---|---|---|
| `.xlsx` / `.xls` | in scope | `xlsx` lib → `sheet_to_csv` → cell map → grid |
| `.csv` / `.tsv` | in scope | same path |
| `.txt` | deferred (Phase 3) | needs delimiter/structure inference |
| QBO reports | in scope — **routed** | `looksLikeQbo` → `src/data/qbo/` parsers (already normalized); the loop never sees QBO |

## Layout

```
src/data/
  index.ts                 # load layer: loadUserData / list / get / update / delete / clear
  stage.ts                 # primitives (header/type/cell-map/parse)
  stats.ts                 # aggregation
  saveData.ts              # envelope -> DataEntry
  synth.ts                 # legacy (deprecated in favor of normalize)
  qbo/                     # QBO parsers (separate module, untouched)
  normalize/
    vers_1/
      README.md            # this file
      index.ts             # normalizeData(content, source, config?) -> NormalizedDataSet
      types.ts             # NormalizeConfig, RowRole, ColumnRole, NormalizedTable, NormalizedDataSet
      config.ts            # DEFAULT_CONFIG + presets
      entityKey.ts         # longest-common-token-run entity extraction
      ingest.ts            # content -> { grid, cells, contentType }
      qboRoute.ts          # QBO detection + delegation to qbo/
      header.ts            # Pass 0
      columns.ts           # Pass 1
      roles.ts             # Pass 2 (deterministic seed + Jev loop)
      assemble.ts          # Pass 3
      verify.ts            # Pass 4
      skeleton.ts          # value-free skeleton + mask
      tests/
```

## Pipeline

```
input -> ingest (json_cells + grid)
      -> qboRoute? (delegate to qbo/, emit normalized, done)
      -> Pass 0 header row
      -> Pass 1 column roles
      -> Pass 2 row roles (deterministic seed -> Jev loop)
      -> Pass 3 assembly (deterministic) -> normalized tables + FKs
      -> Pass 4 verification (Jev score; LLM fallback on low score)
      -> write normalized entries + raw json_cells + metadata
```

- **Pass 0 — header row**: deterministic scan of the first ~20 rows (reuses `stage.ts` `isHeaderLike`); Jev `noul` fallback when ambiguous.
- **Pass 1 — column roles**: deterministic alias lookup against `config.columnAliases`; Jev `choice` fallback for unknown headers.
- **Pass 2 — row roles**: the Classifier loop (see below).
- **Pass 3 — assembly**: group `section_key`/`detail`/`continuation` into blocks, forward-fill keys, drop `title/blank/totals/footer`, cast types by column role (`parseNumber`, `isDateLike`), emit tables + FKs.
- **Pass 4 — verification**: one Jev `score` per table; below threshold → widen window, or LLM value-free fallback, or mark `unresolved`.

## NormalizeConfig (the tuning surface)

```ts
interface NormalizeConfig {
  // engines
  allowJev: boolean;            // default true
  allowLlm: boolean;            // default false (escape hatch only)
  jevModel: string;             // default "jev-latest"

  // classification
  contextWindowSize: number;    // total rows in the window (odd); default 5 = 2 above + 2 below + target
  rowRoleMinConfidence: number; // default 0.6
  deterministicFirst: boolean;  // default true (regex seed before Jev)
  sampleMaxRows: number;        // 0 = all; N = classify first N rows, apply rules to the rest

  // row heuristics (deterministic seed, overridable per use case)
  sectionKeyPattern: RegExp;    // default /^\d{4}\s*-\s/
  balanceForwardPattern: RegExp;
  totalsPattern: RegExp;
  datePattern: RegExp;

  // column role mapping
  columnAliases: Record<ColumnRole, string[]>;
  rowRoles: RowRole[];          // subset/rename of the fixed enum
  columnRoles: ColumnRole[];

  // output
  outputTables: string[];       // e.g. ["accounts", "transactions"]
  normalizeFks: boolean;        // default true
  verifyTables: boolean;        // default true
  verifyMinScore: number;       // default 3 (of 5)
}

type RowRole =
  | "header" | "title" | "blank" | "section_key"
  | "detail" | "continuation" | "totals" | "footer";

type ColumnRole =
  | "account" | "date" | "description" | "amount"
  | "debit" | "credit" | "balance" | "id" | "name" | "type" | "ignore";
```

Presets compose over defaults (no new code):

```ts
const presets = {
  generic:          {},
  financeStatement: { sectionKeyPattern: /^\d{4}\s*-\s/, contextWindowSize: 5,
                      outputTables: ["accounts", "transactions"] },
  journal:          { columnAliases: { id: ["num","no."], /* … */ }, outputTables: ["entries","lines"] },
  // qbo is handled by qboRoute, not a preset
};
```

## The Classifier loop (Pass 2)

For each row below the header not already nailed by the deterministic seed:

1. Build a **value-free skeleton** for the `contextWindowSize` window (cheap and privacy-safe): column letters + type hints (`date-like`, `number-like`, `long-text`, `short-code`), never raw values (`skeleton.ts`).
2. Send one Jev call:
   ```jsonc
   state     = { window: skeleton, target: "r4" }
   questions = { role: { type: "choice",
     instructions: "What role does the target row play?",
     criteria: { header:"…", title:"…", blank:"…", section_key:"…",
                 detail:"…", continuation:"…", totals:"…", footer:"…" } } }
   ```
3. Receive `{ role, probabilities, confidence }`; store per-row label + confidence.
4. `confidence < rowRoleMinConfidence` → re-run with a wider window, or mark `unresolved`.

Cost model: **1 Jev call per ambiguous row** (deterministic seed removes the easy ones); `sampleMaxRows` bounds it for large files. This is the "tool in itself": a deterministic driver that loops Jev categorical calls and feeds the answers to a deterministic assembler.

## Normalized output model

```ts
interface NormalizedTable {
  name: string;
  columns: string[];
  columnTypes: Record<string, "number" | "boolean" | "string">;
  rows: Record<string, unknown>[];
  foreignKeys?: { column: string; references: { table: string; column: string } }[];
}

interface NormalizedDataSet {
  tables: NormalizedTable[];
  config: NormalizeConfig;
  engine: "deterministic" | "jev" | "llm" | "qbo";
  confidence: {
    rowRoles: { row: number; role: RowRole; confidence: number }[];
    tableScores: Record<string, number>;
  };
  unresolved: { row: number; issue: string }[];
}
```

For an I-statement this yields two tables — `accounts { name, entity_key, balance_forward }` and
`transactions { account_fk, doc_dt, doc, description, department, budget, txn_no, debit, credit }` —
joined by `account_fk`. The earlier single flat `[account, entity_key, memo, matches]` shape is superseded.

## Load integration & read contract

- `loadUserData` calls `normalizeData(...)` before storing.
- Store: (a) raw `json_cells` entry (audit + re-normalize), (b) normalized `synth_<name>_<table>` entries, (c) metadata `{ normalized: true, config_hash, tables, unresolved }`.
- `config_hash` enables idempotent re-normalization when the config changes.
- **Read contract**: `get_data`, `aggregate_data`, workflow params (`{{name}}` → envelope), and chat read normalized tables by default. Raw cells are surfaced only on explicit request.

## Engine split & fallback policy

| Task | Engine | Trigger |
|---|---|---|
| header / column roles | deterministic | always |
| row roles (easy rows) | deterministic regex seed | `deterministicFirst` |
| row roles (ambiguous) | Jev `choice` | seed miss or low confidence |
| assembly / typing / FKs | deterministic | always |
| table verification | Jev `score` | `verifyTables` |
| unknown layout | LLM (value-free) | Jev confidence below threshold |

## Testing & tuning

- Unit tests per stage with fixtures: statement (`odd_rows.xlsx`-style), journal continuation, clean flat CSV, totals/footer rows, QBO GL sample (routing).
- A `normalizeBench.ts` harness scores a preset's row-classification accuracy so presets can be tuned without code changes.
- Confidence thresholds and patterns are the primary tuning knobs (accuracy vs. cost vs. speed).

## Migration checklist (from the pre-`src/data/` layout)

- `src/workspace/user-data/*` → `src/data/*`
- `src/workspace/qbo/` → `src/data/qbo/`
- `src/workspace/shapes/` → folded into `src/data/normalize/vers_1/`
- `src/mcp/servers/app-wfp-data/` stays (MCP server); imports repointed to `@data/*`
- `src/types/data.ts` + `src/types/qbo.ts` stay (the `wfp-format` file-format contract)
- `src/shared/wfp-api/csv.ts` stays (shared wfp-api CSV)

## Rollout phases

- **Phase 1**: bundle + `NormalizeConfig` + ingest + header/columns + deterministic seed + Jev row-role loop + assembly → normalized tables + load integration (xlsx/csv/tsv + QBO routing).
- **Phase 2**: verification loop + LLM escape hatch + preset refinement.
- **Phase 3**: `.txt` structural inference + on-demand re-normalization from chat.
