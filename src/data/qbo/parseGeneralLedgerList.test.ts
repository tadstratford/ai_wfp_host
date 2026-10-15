import { describe, expect, test } from "bun:test";
import { buildCellMap } from "../stage";
import { recognizeQboReport, looksLikeQbo } from "./recognize";
import { parseGeneralLedgerList } from "./parseGeneralLedgerList";
import { trialBalance } from "./query";

const SAMPLE = `Sandbox Company US 1474,,,,,,,,,
General Ledger List,,,,,,,,,
"May 1-31, 2026",,,,,,,,,
,,,,,,,,,
,Distribution account,Transaction date,Description,Name,Transaction ID,Num,Balance,Debit,Credit
Checking,,,,,,,,,
,Beginning Balance,,,,,,"4,179.36",,
,Checking,05/04/2026,,Kate Whelan,17,1008,"4,490.76",225.00,
,Checking,05/06/2026,,Amy's Bird Sanctuary,72,,"4,595.76",105.00,
,Checking,05/08/2026,,Hicks Hardware,79,7,"4,345.76",,250.00
Total for Checking,,,,,,,,"$3,096.35","$5,151.21"
Savings,,,,,,,,,
,Savings,05/25/2026,Opening Balance,,5,,600.00,600.00,
,Savings,05/29/2026,Money to savings,,121,,800.00,200.00,
Total for Savings,,,,,,,,$800.00,$0.00
Job Materials,,,,,,,,,
Fountains and Garden Lighting,,,,,,,,,
,Fountains and Garden Lighting,05/07/2026,Rock Fountain,Amy's Bird Sanctuary,67,1021,275.00,,275.00
Total for Fountains and Garden Lighting,,,,,,,,$0.00,$275.00
Total for Job Materials with sub-accounts,,,,,,,,$0.00,$275.00
"Accrual Basis Saturday, September 12, 2026 09:10 PM GMTZ",,,,,,,,,`;

function cells(): Record<string, string> {
  const cm = buildCellMap(SAMPLE);
  if (!cm) throw new Error("buildCellMap returned null");
  return cm.cells;
}

describe("recognizeQboReport", () => {
  test("identifies a General Ledger List report", () => {
    const rec = recognizeQboReport(cells());
    expect(rec?.kind).toBe("general_ledger_list");
  });

  test("does not misclassify a plain table with a journal column", () => {
    const cm = buildCellMap("journal,transaction type\nSALES,Invoice");
    if (!cm) throw new Error("buildCellMap returned null");
    expect(recognizeQboReport(cm.cells)).toBeNull();
  });
});

describe("looksLikeQbo", () => {
  test("detects QBO titles cheaply and rejects ordinary tables", () => {
    expect(looksLikeQbo("Sandbox Company US 1474\nGeneral Ledger List\nMay 1-31, 2026")).toBe(true);
    expect(looksLikeQbo("Chart of Accounts\nName,Number,Type")).toBe(true);
    expect(looksLikeQbo("journal,transaction type\nSALES,Invoice")).toBe(true);
    expect(looksLikeQbo("date,account,debit,credit\n2026-05-04,Checking,225.00,0")).toBe(false);
  });
});

describe("parseGeneralLedgerList", () => {
  test("extracts accounts, opening balances, and lines", () => {
    const gl = parseGeneralLedgerList(cells(), "gl.csv");

    // Accounts: Checking, Savings, Job Materials (parent), Fountains (child).
    expect(gl.accounts.name).toContain("Checking");
    expect(gl.accounts.name).toContain("Savings");
    expect(gl.accounts.name).toContain("Job Materials");
    expect(gl.accounts.name).toContain("Fountains and Garden Lighting");

    const checkingIdx = gl.accounts.name.indexOf("Checking");
    expect(gl.accounts.parent[checkingIdx]).toBeNull();
    expect(gl.accounts.openingBalance[checkingIdx]).toBeCloseTo(4179.36, 2);

    const fountainsIdx = gl.accounts.name.indexOf("Fountains and Garden Lighting");
    expect(gl.accounts.parent[fountainsIdx]).toBe("Job Materials");

    // The report footer is not parsed as an account.
    expect(gl.accounts.name.some((n) => n.startsWith("Accrual Basis"))).toBe(false);

    // Lines: 3 checking + 2 savings + 1 fountains.
    expect(gl.lines.accountIndex.length).toBe(6);

    // First line: debit 225 → amount +225, date normalized, name captured.
    expect(gl.lines.date[0]).toBe("2026-05-04");
    expect(gl.lines.period[0]).toBe("2026-05");
    expect(gl.lines.debit[0]).toBeCloseTo(225, 2);
    expect(gl.lines.amount[0]).toBeCloseTo(225, 2);
    expect(gl.lines.name[0]).toBe("Kate Whelan");
    expect(gl.lines.txnId[0]).toBe("17");

    // Third line: credit 250 → amount −250.
    expect(gl.lines.credit[2]).toBeCloseTo(250, 2);
    expect(gl.lines.amount[2]).toBeCloseTo(-250, 2);

    // Savings opening-balance transaction is a regular line with description.
    const savingsLines = gl.lines.description.filter((d) => d === "Opening Balance");
    expect(savingsLines.length).toBe(1);
  });

  test("derives trial balance from opening balance + activity", () => {
    const gl = parseGeneralLedgerList(cells(), "gl.csv");
    const tb = trialBalance(gl);
    const checking = tb.find((r) => r.account === "Checking");
    expect(checking).toBeDefined();
    // 4179.36 + 225 + 105 − 250 = 4259.36
    expect(checking!.balance).toBeCloseTo(4259.36, 2);
  });
});

const GL_AMOUNT_SAMPLE = `General Ledger,,,,,,,,,
"May 1-31, 2026",,,,,,,,,
,,,,,,,,,
,Distribution account,Transaction date,Transaction type,Num,Name,Description,Split,Amount,Balance
100000 SVB Checking,,,,,,,,,
,Beginning Balance,,,,,,,,"4,179.36"
,100000 SVB Checking,05/04/2026,Journal,1008,Kate Whelan,,Sales,225.00,
,100000 SVB Checking,05/08/2026,Journal,7,Hicks Hardware,,AP,-250.00,
Total for 100000 SVB Checking,,,,,,,,`;

function amountCells(): Record<string, string> {
  const cm = buildCellMap(GL_AMOUNT_SAMPLE);
  if (!cm) throw new Error("buildCellMap returned null");
  return cm.cells;
}

describe("parseGeneralLedgerList — single Amount column (General Ledger report)", () => {
  test("recognizes and splits signed Amount into debit/credit", () => {
    expect(recognizeQboReport(amountCells())?.kind).toBe("general_ledger_list");

    const gl = parseGeneralLedgerList(amountCells(), "gl-amount.csv");
    expect(gl.accounts.name).toContain("100000 SVB Checking");

    // Two data lines.
    expect(gl.lines.accountIndex.length).toBe(2);

    // +225.00 → debit.
    expect(gl.lines.debit[0]).toBeCloseTo(225, 2);
    expect(gl.lines.credit[0]).toBeCloseTo(0, 2);
    expect(gl.lines.amount[0]).toBeCloseTo(225, 2);

    // −250.00 → credit.
    expect(gl.lines.debit[1]).toBeCloseTo(0, 2);
    expect(gl.lines.credit[1]).toBeCloseTo(250, 2);
    expect(gl.lines.amount[1]).toBeCloseTo(-250, 2);

    // Beginning Balance captured from the Balance column.
    const idx = gl.accounts.name.indexOf("100000 SVB Checking");
    expect(gl.accounts.openingBalance[idx]).toBeCloseTo(4179.36, 2);
  });
});

// QuickBooks Online "General Ledger" layout: the account appears only on the
// section-header row (column A); detail rows leave column A blank and use
// "Date / Transaction Type / … / Split / Amount / Balance" (no Debit/Credit,
// no "Distribution account"). This is the layout that previously dropped nearly
// every detail row because both column A and the account column were empty.
const QBO_GL_SAMPLE = `Sandbox Company US 1474,,,,,,,,,
General Ledger,,,,,,,,,
"May 1-31, 2026",,,,,,,,,
,,,,,,,,,
,Date,Transaction Type,Num,Name,Memo/Description,Split,Amount,Balance
100000 SVB Checking,,,,,,,,,
,Beginning Balance,,,,,,,"4,179.36"
,05/04/2026,Journal,1008,Kate Whelan,,Sales,225.00,"4,490.76"
,05/08/2026,Journal,7,Hicks Hardware,,AP,-250.00,"4,240.76"
Total for 100000 SVB Checking,,,,,,,,,-25.00
Savings,,,,,,,,,
,Beginning Balance,,,,,,,"600.00"
,05/25/2026,Journal,,Opening Balance,,,600.00,"1,200.00"
Total for Savings,,,,,,,,600.00
"Accrual Basis Saturday, September 12, 2026 09:10 PM GMTZ",,,,,,,,,`;

function qboGlCells(): Record<string, string> {
  const cm = buildCellMap(QBO_GL_SAMPLE);
  if (!cm) throw new Error("buildCellMap returned null");
  return cm.cells;
}

describe("parseGeneralLedgerList — QuickBooks Online layout (no account column)", () => {
  test("forward-fills the account from section rows and captures every detail line", () => {
    expect(recognizeQboReport(qboGlCells())?.kind).toBe("general_ledger_list");

    const gl = parseGeneralLedgerList(qboGlCells(), "qbo-gl.csv");

    expect(gl.accounts.name).toEqual(["100000 SVB Checking", "Savings"]);
    expect(gl.accounts.openingBalance[0]).toBeCloseTo(4179.36, 2);
    expect(gl.accounts.openingBalance[1]).toBeCloseTo(600, 2);

    // 2 SVB lines + 1 Savings line — all detail rows survive.
    expect(gl.lines.accountIndex).toEqual([0, 0, 1]);

    expect(gl.lines.date[0]).toBe("2026-05-04");
    expect(gl.lines.name[0]).toBe("Kate Whelan");
    expect(gl.lines.num[0]).toBe("1008");
    expect(gl.lines.debit[0]).toBeCloseTo(225, 2);
    expect(gl.lines.credit[1]).toBeCloseTo(250, 2);
    expect(gl.lines.amount[1]).toBeCloseTo(-250, 2);
  });
});
