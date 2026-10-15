// QBO report types — shapes produced by the QBO report parsers feeding the
// Data-load path. A recognized QBO upload (General Ledger / Journal / Chart of
// Accounts) is parsed into one of these columnar shapes, then normalized to a
// CSV table and stored as a workspace data entry (`*_qbo_*`).
//
// Storage is raw/unmasked (the file owner owns the data). Masking is applied
// only at LLM egress boundaries.

/** Canonical QBO journal (transaction-centric): headers + lines. */
export interface QboJournal {
  schemaVersion: 1;
  headers: {
    /** 'YYYY-MM-DD' */
    date: string[];
    /** 'YYYY-MM' */
    period: string[];
    /** 'Journal' | 'Bill' | 'Invoice' | … */
    transactionType: string[];
    /** Journal / reference number. */
    num: string[];
    /** Payee / vendor / customer at the document level. */
    name: string[];
    /** Header memo. */
    memo: string[];
    /** Import provenance (source filename). */
    sourceFile: string[];
    /** 'qbo_journal' | 'qbo_live'. */
    source: string[];
  };
  lines: {
    /** Index into headers[] arrays. */
    headerIndex: number[];
    lineNo: number[];
    account: string[];
    accountType: string[];
    debit: number[];
    credit: number[];
    /** Signed amount — debit +, credit −. The reporting column. */
    amount: number[];
    memo: string[];
    vendor: string[];
    customer: string[];
    class: string[];
    location: string[];
  };
}

/** QBO General Ledger List report (account-centric): accounts + lines. */
export interface QboGeneralLedgerList {
  schemaVersion: 1;
  accounts: {
    /** Leaf account name (as shown in the "Distribution account" column). */
    name: string[];
    /** Immediate parent account leaf name, or null for a top-level account. */
    parent: (string | null)[];
    accountType: string[];
    /** Opening balance from the account's "Beginning Balance" row (signed). */
    openingBalance: number[];
  };
  lines: {
    /** Index into accounts[] arrays. */
    accountIndex: number[];
    date: string[];
    period: string[];
    /** Line description (sparse in the GL report). */
    description: string[];
    /** Payee / vendor / customer. */
    name: string[];
    /** QBO Transaction ID — line data, not promoted to a header. */
    txnId: string[];
    num: string[];
    debit: number[];
    credit: number[];
    /** Signed amount — debit +, credit −. */
    amount: number[];
    sourceFile: string[];
    /** 'qbo_gl'. */
    source: string[];
  };
}

/** QBO Chart of Accounts / Account List (optional). */
export interface QboChartOfAccounts {
  schemaVersion: 1;
  accounts: {
    name: string[];
    number: string[];
    /** Income | Expense | Asset | Liability | Equity | … */
    type: string[];
    subType: string[];
    parent: (string | null)[];
    active: boolean[];
  };
}