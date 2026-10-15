// Pass 3 — deterministic assembly: row-role labels → normalized related tables
// with foreign keys. No LLM/Jev; pure and unit-testable.

import { firstNonEmpty } from "./apply";
import { extractEntityKey, findMemo } from "./specs";
import type { NormalizeConfig, NormalizedTable } from "./types";
import type { RowClassification } from "./roles";

/** Assemble a statement-detail layout into `accounts` + `transactions`. */
export function assembleNormalized(
  grid: string[][],
  classes: RowClassification[],
  config: NormalizeConfig,
): NormalizedTable[] {
  const accounts: Record<string, unknown>[] = [];
  const transactions: Record<string, unknown>[] = [];
  let currentAccountId: number | null = null;
  let currentEntity = "";
  let currentAccountName = "";

  for (const c of classes) {
    const row = grid[c.row] ?? [];
    if (c.role === "section_key") {
      const name = firstNonEmpty(row);
      const entity = extractEntityKey(name) ?? "";
      const id = accounts.length;
      accounts.push({ id, name, entity_key: entity });
      currentAccountId = id;
      currentEntity = entity;
      currentAccountName = name;
    } else if (
      (c.role === "detail" || c.role === "continuation") &&
      currentAccountId != null
    ) {
      const memo = findMemo(row, currentEntity);
      transactions.push({
        account_fk: currentAccountId,
        account: currentAccountName,
        memo,
        matches: currentEntity !== "" && memo.includes(currentEntity),
      });
    }
  }

  const tables: NormalizedTable[] = [];
  const want = new Set(config.outputTables);

  if (accounts.length > 0 && want.has("accounts")) {
    tables.push({
      name: "accounts",
      columns: ["id", "name", "entity_key"],
      columnTypes: { id: "number", name: "string", entity_key: "string" },
      rows: accounts,
    });
  }
  if (transactions.length > 0 && want.has("transactions")) {
    tables.push({
      name: "transactions",
      columns: ["account_fk", "account", "memo", "matches"],
      columnTypes: { account_fk: "number", account: "string", memo: "string", matches: "boolean" },
      rows: transactions,
      foreignKeys: config.normalizeFks
        ? [{ column: "account_fk", references: { table: "accounts", column: "id" } }]
        : undefined,
    });
  }
  return tables;
}
