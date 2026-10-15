// Deterministic parser: QBO Chart of Accounts / Account List → QboChartOfAccounts.
//
// The account list is a flat table (Name, Type, Detail Type, …). Sub-account
// hierarchy is best-effort (parent left null) until a real export sample is
// available to key off.

import type { QboChartOfAccounts } from "wfp-format/qbo";
import {
  columnIndex,
  findHeaderRow,
  gridFromCells,
  type CellMap,
} from "./helpers";

export function parseChartOfAccounts(cells: CellMap): QboChartOfAccounts {
  const grid = gridFromCells(cells);
  const headerRow = findHeaderRow(grid);
  if (headerRow < 0) return emptyCoa();

  const cName = columnIndex(grid, headerRow, "name", "account", "account name");
  const cNumber = columnIndex(grid, headerRow, "account number", "account #", "number");
  const cType = columnIndex(grid, headerRow, "type", "account type");
  const cSubType = columnIndex(grid, headerRow, "detail type", "detail", "subtype");

  const accounts = {
    name: [] as string[],
    number: [] as string[],
    type: [] as string[],
    subType: [] as string[],
    parent: [] as (string | null)[],
    active: [] as boolean[],
  };

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const name = cName >= 0 ? cell(row, cName) : "";
    if (!name) continue;
    accounts.name.push(name);
    accounts.number.push(cNumber >= 0 ? cell(row, cNumber) : "");
    accounts.type.push(cType >= 0 ? cell(row, cType) : "");
    accounts.subType.push(cSubType >= 0 ? cell(row, cSubType) : "");
    accounts.parent.push(null);
    accounts.active.push(true);
  }

  return { schemaVersion: 1, accounts };
}

function cell(row: string[] | undefined, col: number): string {
  if (col < 0 || !row) return "";
  return (row[col] ?? "").trim();
}

function emptyCoa(): QboChartOfAccounts {
  return {
    schemaVersion: 1,
    accounts: { name: [], number: [], type: [], subType: [], parent: [], active: [] },
  };
}
