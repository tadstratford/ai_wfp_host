// Derived trial-balance helpers over parsed QBO reports (journal or
// general_ledger_list). Kept separate from the parsers because they are pure
// functions over the report shapes and are covered by unit tests.

import type {
  QboGeneralLedgerList,
  QboJournal,
} from "wfp-format/qbo";

export interface TrialBalanceRow {
  accountIndex: number;
  account: string;
  accountType: string;
  openingBalance: number;
  activity: number;
  balance: number;
}

function journalLines(journal: QboJournal): { account: string; accountType: string; amount: number }[] {
  const out: { account: string; accountType: string; amount: number }[] = [];
  for (let i = 0; i < journal.lines.account.length; i++) {
    const h = journal.lines.headerIndex[i] ?? 0;
    out.push({
      account: journal.lines.account[i] ?? "",
      accountType: journal.lines.accountType[i] ?? "",
      amount: journal.lines.amount[i] ?? 0,
    });
  }
  return out;
}

/** Derived trial balance from the general_ledger_list node (opening + activity). */
export function trialBalance(gl: QboGeneralLedgerList): TrialBalanceRow[] {
  const rows: TrialBalanceRow[] = gl.accounts.name.map((name, i) => ({
    accountIndex: i,
    account: name,
    accountType: gl.accounts.accountType[i] ?? "",
    openingBalance: gl.accounts.openingBalance[i] ?? 0,
    activity: 0,
    balance: gl.accounts.openingBalance[i] ?? 0,
  }));

  for (let i = 0; i < gl.lines.accountIndex.length; i++) {
    const idx = gl.lines.accountIndex[i] ?? 0;
    const amt = gl.lines.amount[i] ?? 0;
    if (rows[idx]) {
      rows[idx].activity += amt;
      rows[idx].balance += amt;
    }
  }
  return rows;
}

/** Derived trial balance from a journal (activity only — no opening balances). */
export function journalTrialBalance(journal: QboJournal): TrialBalanceRow[] {
  const lines = journalLines(journal);
  const map = new Map<string, TrialBalanceRow>();
  for (const l of lines) {
    const g = map.get(l.account) ?? {
      accountIndex: -1,
      account: l.account,
      accountType: l.accountType,
      openingBalance: 0,
      activity: 0,
      balance: 0,
    };
    g.activity += l.amount;
    g.balance += l.amount;
    map.set(l.account, g);
  }
  return Array.from(map.values());
}