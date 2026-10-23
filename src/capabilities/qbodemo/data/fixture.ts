/**
 * qbodemo fixture — a bundled fund-administrator demo company.
 *
 * "Acme Fund Services (Demo)" keeps the books for three funds, modeled as QBO
 * Classes. The dataset is hand-authored here (no filesystem read) so it works
 * in dev and in the compiled binary. Amounts are natural sign (income +,
 * expense +, cash balance +).
 */

export interface DemoAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
  Classification: string;
  CurrentBalance: number;
  Active: boolean;
}

export interface DemoClass {
  Id: string;
  Name: string;
  Active: boolean;
}

export interface DemoActual {
  qboName: string;
  qboId: string;
  period: string; // "YYYY-MM"
  amount: number;
}

export interface DemoCashBalance {
  period: string; // "YYYY-MM"
  amount: number;
}

export const DEMO_COMPANY_NAME = "Acme Fund Services (Demo)";

export const ACCOUNTS: DemoAccount[] = [
  { Id: "100", Name: "Management Fees", AccountType: "Income", AccountSubType: "ServiceFeeIncome", Classification: "Revenue", CurrentBalance: 0, Active: true },
  { Id: "101", Name: "Admin Fees", AccountType: "Income", AccountSubType: "ServiceFeeIncome", Classification: "Revenue", CurrentBalance: 0, Active: true },
  { Id: "102", Name: "Interest Income", AccountType: "Income", AccountSubType: "InterestIncome", Classification: "Revenue", CurrentBalance: 0, Active: true },
  { Id: "200", Name: "Salaries & Benefits", AccountType: "Expense", AccountSubType: "PayrollExpenses", Classification: "Expense", CurrentBalance: 0, Active: true },
  { Id: "201", Name: "Professional Fees", AccountType: "Expense", AccountSubType: "ProfessionalFees", Classification: "Expense", CurrentBalance: 0, Active: true },
  { Id: "202", Name: "Technology", AccountType: "Expense", AccountSubType: "OtherBusinessExpenses", Classification: "Expense", CurrentBalance: 0, Active: true },
  { Id: "203", Name: "Office & Occupancy", AccountType: "Expense", AccountSubType: "RentOrLeaseOfBuildings", Classification: "Expense", CurrentBalance: 0, Active: true },
  { Id: "204", Name: "Shared Services", AccountType: "Expense", AccountSubType: "OtherBusinessExpenses", Classification: "Expense", CurrentBalance: 0, Active: true },
  { Id: "300", Name: "Operating Cash", AccountType: "Bank", AccountSubType: "Checking", Classification: "Asset", CurrentBalance: 0, Active: true },
  { Id: "301", Name: "Accounts Receivable", AccountType: "Accounts Receivable", AccountSubType: "AccountsReceivable", Classification: "Asset", CurrentBalance: 0, Active: true },
  { Id: "302", Name: "Accounts Payable", AccountType: "Accounts Payable", AccountSubType: "AccountsPayable", Classification: "Liability", CurrentBalance: 0, Active: true },
  { Id: "303", Name: "Shared Services Clearing", AccountType: "Other Current Liabilities", AccountSubType: "OtherCurrentLiabilities", Classification: "Liability", CurrentBalance: 0, Active: true },
];

export const CLASSES: DemoClass[] = [
  { Id: "900", Name: "Alpha Growth Fund LP", Active: true },
  { Id: "901", Name: "Beta Income Fund LP", Active: true },
  { Id: "902", Name: "Omega Real Estate Fund LP", Active: true },
];

/** Fiscal year the demo operates in. */
export const FY = 2026;

/** Opening cash balance at the start of the fiscal year. */
const OPENING_CASH = 520000;

/**
 * Base monthly amount per reporting (flow) account. Natural sign. The `Shared
 * Services` line is the shared-services expense allocated to the funds in the
 * second demo.
 */
const BASE_MONTHLY: Record<string, number> = {
  "Management Fees": 120000,
  "Admin Fees": 20000,
  "Interest Income": 6000,
  "Salaries & Benefits": 62000,
  "Professional Fees": 26000,
  "Technology": 12500,
  "Office & Occupancy": 16000,
  "Shared Services": 30000,
};

/**
 * Deterministic seasonal factor (no randomness — the demo replays identically).
 * Drives a mild seasonal shape: fees drift up over the year, expenses are a
 * touch lumpier around quarter ends.
 */
function seasonalFactor(account: string, month: number): number {
  const isIncome = account === "Management Fees" || account === "Admin Fees" || account === "Interest Income";
  if (isIncome) {
    // Revenue climbs through the year (more AUM), with a Q4 bump.
    const base = 0.95 + month * 0.008;
    if (month === 10 || month === 11 || month === 12) return base * 1.04;
    return base;
  }
  if (account === "Salaries & Benefits") {
    // Payroll is steady, with a year-end bonus in December.
    return month === 12 ? 1.06 : 1.0;
  }
  if (account === "Professional Fees") {
    // Audit/tax fees bunch around Q1 and Q4.
    return month === 1 || month === 2 || month === 11 || month === 12 ? 1.15 : 0.9;
  }
  if (account === "Shared Services") {
    return 1.0;
  }
  // Technology / Office & Occupancy — steady.
  return 1.0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function monthAmount(account: string, month: number): number {
  const base = BASE_MONTHLY[account];
  if (base === undefined) return 0;
  return round2(base * seasonalFactor(account, month));
}

/** Build the flat actuals feed for the whole fiscal year. */
export const ACTUALS: DemoActual[] = (() => {
  const out: DemoActual[] = [];
  for (const acct of ACCOUNTS) {
    if (!(acct.Name in BASE_MONTHLY)) continue;
    for (let m = 1; m <= 12; m++) {
      out.push({
        qboName: acct.Name,
        qboId: acct.Id,
        period: `${FY}-${String(m).padStart(2, "0")}`,
        amount: monthAmount(acct.Name, m),
      });
    }
  }
  return out;
})();

/** Month-end Operating Cash — opening + cumulative net income. */
export const CASH_BALANCES: DemoCashBalance[] = (() => {
  const out: DemoCashBalance[] = [];
  let cash = OPENING_CASH;
  for (let m = 1; m <= 12; m++) {
    let net = 0;
    for (const acct of ACCOUNTS) {
      if (!(acct.Name in BASE_MONTHLY)) continue;
      const amount = monthAmount(acct.Name, m);
      if (acct.Classification === "Revenue") net += amount;
      else net -= amount;
    }
    cash = round2(cash + net);
    out.push({ period: `${FY}-${String(m).padStart(2, "0")}`, amount: cash });
  }
  return out;
})();
