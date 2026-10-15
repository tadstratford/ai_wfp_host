// Normalization config — the single tuning surface. Presets compose over
// defaults; use-case differences are data, not code.

import type { ColumnRole, NormalizeConfig, RowRole } from "./types";

export const DEFAULT_CONFIG: NormalizeConfig = {
  allowJev: true,
  allowLlm: false,
  jevModel: "jev-latest",

  contextWindowSize: 5,
  rowRoleMinConfidence: 0.6,
  deterministicFirst: true,
  sampleMaxRows: 0,

  sectionKeyPattern: /^\d{4}\s*-\s/,
  balanceForwardPattern: /balance\s+forward/i,
  totalsPattern: /^(total|subtotal|grand total|net total|totals)(\b|$)/i,
  datePattern: /^\d{1,2}\/\d{1,2}\/\d{2,4}/,

  columnAliases: {
    account: ["account", "distribution account", "account name", "split"],
    date: ["date", "doc dt.", "transaction date", "txn date"],
    description: ["description", "memo/description", "memo", "memo/desc"],
    amount: ["amount", "txn amt", "transaction amount"],
    debit: ["debit", "debit (usd)"],
    credit: ["credit", "credit (usd)"],
    balance: ["balance", "balance (usd)"],
    id: ["id", "doc", "num", "no.", "number", "transaction id", "txn no", "doc #"],
    name: ["name", "vendor name", "vendor"],
    type: ["type", "transaction type", "jnl", "journal"],
    ignore: [],
  },

  rowRoles: [
    "header",
    "title",
    "blank",
    "section_key",
    "detail",
    "continuation",
    "totals",
    "footer",
  ],
  columnRoles: [
    "account",
    "date",
    "description",
    "amount",
    "debit",
    "credit",
    "balance",
    "id",
    "name",
    "type",
    "ignore",
  ],

  outputTables: ["accounts", "transactions"],
  normalizeFks: true,
  verifyTables: true,
  verifyMinScore: 3,
};

export type Preset = Partial<NormalizeConfig>;

export const presets: Record<string, Preset> = {
  generic: {},
  financeStatement: {
    sectionKeyPattern: /^\d{4}\s*-\s/,
    contextWindowSize: 5,
    outputTables: ["accounts", "transactions"],
  },
  journal: {
    columnAliases: {
      ...DEFAULT_CONFIG.columnAliases,
      id: ["num", "no.", "number", "doc no", "doc #"],
    },
    outputTables: ["entries", "lines"],
  },
};

/** Merge presets + overrides over defaults into a resolved config. */
export function resolveConfig(
  presetName?: string,
  overrides?: Preset,
): NormalizeConfig {
  const preset = (presetName && presets[presetName]) || {};
  const merged: NormalizeConfig = {
    ...DEFAULT_CONFIG,
    ...preset,
    ...(overrides ?? {}),
    columnAliases: {
      ...DEFAULT_CONFIG.columnAliases,
      ...(preset.columnAliases ?? {}),
      ...(overrides?.columnAliases ?? {}),
    },
    rowRoles: overrides?.rowRoles ?? preset.rowRoles ?? DEFAULT_CONFIG.rowRoles,
    columnRoles:
      overrides?.columnRoles ?? preset.columnRoles ?? DEFAULT_CONFIG.columnRoles,
  };
  return merged;
}

/** All available role enums (for Jev criteria + validation). */
export function allRowRoles(): RowRole[] {
  return DEFAULT_CONFIG.rowRoles;
}

export function allColumnRoles(): ColumnRole[] {
  return DEFAULT_CONFIG.columnRoles;
}
