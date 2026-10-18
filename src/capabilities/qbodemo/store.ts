import {
  ACCOUNTS,
  CLASSES,
  ACTUALS,
  CASH_BALANCES,
  DEMO_COMPANY_NAME,
  type DemoAccount,
  type DemoClass,
  type DemoActual,
  type DemoCashBalance,
} from "./data/fixture";

/**
 * DemoQboStore — the in-memory ledger behind the `qbodemo` capability. It is a
 * drop-in stand-in for the live `QBOClient`: reads come from the bundled
 * fixture, journal posts accumulate here so `qbodemo_journal_entries` can read
 * them back. Nothing ever leaves the process or touches Intuit.
 */

export interface DemoJournalLine {
  Description?: string;
  Amount: number;
  DetailType: "JournalEntryLineDetail";
  JournalEntryLineDetail: {
    PostingType: "Debit" | "Credit";
    AccountRef: { value: string; name?: string };
    ClassRef?: { value: string; name?: string };
  };
}

export interface DemoJournalEntry {
  Id: string;
  TxnDate: string;
  DocNumber?: string;
  PrivateNote?: string;
  Line: DemoJournalLine[];
}

export interface DemoJournalEntryInput {
  TxnDate: string;
  PrivateNote?: string;
  DocNumber?: string;
  Line: DemoJournalLine[];
}

class DemoQboStore {
  private journal: DemoJournalEntry[] = [];
  private seq = 1;

  companyName(): string {
    return DEMO_COMPANY_NAME;
  }

  accounts(): DemoAccount[] {
    return ACCOUNTS;
  }

  classes(): DemoClass[] {
    return CLASSES;
  }

  /** Flat actuals whose period falls within [startDate, endDate] (inclusive). */
  actualsInRange(startDate: string, endDate: string): DemoActual[] {
    const start = startDate.slice(0, 7);
    const end = endDate.slice(0, 7);
    return ACTUALS.filter((a) => a.period >= start && a.period <= end);
  }

  cashBalances(): DemoCashBalance[] {
    return CASH_BALANCES;
  }

  /** Flow accounts (income/expense) that carry monthly actuals. */
  flowAccounts(): DemoAccount[] {
    return ACCOUNTS.filter((a) =>
      ACTUALS.some((x) => x.qboId === a.Id),
    );
  }

  /** Total amount for a flow account within [startDate, endDate]. */
  amountFor(accountId: string, startDate: string, endDate: string): number {
    const start = startDate.slice(0, 7);
    const end = endDate.slice(0, 7);
    return ACTUALS
      .filter((a) => a.qboId === accountId && a.period >= start && a.period <= end)
      .reduce((s, a) => s + a.amount, 0);
  }

  /** Amount for a flow account in a single month period ("YYYY-MM"). */
  amountForPeriod(accountId: string, period: string): number {
    const a = ACTUALS.find((x) => x.qboId === accountId && x.period === period);
    return a?.amount ?? 0;
  }

  journalEntries(): DemoJournalEntry[] {
    return this.journal;
  }

  createJournalEntry(entry: DemoJournalEntryInput): DemoJournalEntry {
    const created: DemoJournalEntry = {
      Id: `DEMO-${this.seq++}`,
      TxnDate: entry.TxnDate,
      ...(entry.PrivateNote ? { PrivateNote: entry.PrivateNote } : {}),
      ...(entry.DocNumber ? { DocNumber: entry.DocNumber } : {}),
      Line: entry.Line,
    };
    this.journal.push(created);
    return created;
  }
}

/** Process-wide singleton — the demo company is shared across all workspaces. */
export const demoQbo = new DemoQboStore();
