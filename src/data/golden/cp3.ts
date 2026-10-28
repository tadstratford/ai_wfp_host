// Golden fixtures — real, hand-verified data from the CP3 workspace
// ("Cogenuity" dead-deals engagement) plus the golden numbers the deterministic
// engines must reproduce.
//
// These values were verified by hand during a manual reconciliation of the CP3
// .wfp export, so they are the trusted reference answers. The `cp3.test.ts`
// golden tests feed this data through the engines and assert these exact figures,
// so any future regression in the arithmetic fails immediately.
//
// Provenance: extracted from the CP3 `.wfp` export —
//   - dead_deals_report_dead_deals (30 rows)
//   - ico_transactions_sheet1 (the 4 "Ironwave" rows)
//   - dead_deals_report_estimated_commitments (the "Current Split" row)
// Values are stored exactly as they appeared in the data (currency strings like
// "$9,865.91" and the "$-" zero placeholder).

import type { DiscoveryTable } from "../catalog/discover";

export const deadDealsColumns = [
  "Deal Name",
  "Fund I Expenses",
  "Fund II Expenses",
  "Total Expenses",
  "EBITDA ($m)",
] as const;

export const deadDealsColumnTypes = {
  "Deal Name": "string",
  "Fund I Expenses": "string",
  "Fund II Expenses": "string",
  "Total Expenses": "number",
  "EBITDA ($m)": "number",
} as const;

// The 30-row schedule. The 9 "Active" deals + ZUKO carry no expenses/EBITDA.
export const deadDealsRows: Record<string, unknown>[] = [
  { "Deal Name": "AFEX", "Fund I Expenses": "", "Fund II Expenses": "", "Total Expenses": null, "EBITDA ($m)": null },
  { "Deal Name": "ESP Safety", "Fund I Expenses": "", "Fund II Expenses": "", "Total Expenses": null, "EBITDA ($m)": null },
  { "Deal Name": "Otto", "Fund I Expenses": "", "Fund II Expenses": "", "Total Expenses": null, "EBITDA ($m)": null },
  { "Deal Name": "Pacific Sky Supply", "Fund I Expenses": "", "Fund II Expenses": "", "Total Expenses": null, "EBITDA ($m)": null },
  { "Deal Name": "Smart Cooling", "Fund I Expenses": "", "Fund II Expenses": "", "Total Expenses": null, "EBITDA ($m)": null },
  { "Deal Name": "Stretch Forming Corp", "Fund I Expenses": "", "Fund II Expenses": "", "Total Expenses": null, "EBITDA ($m)": null },
  { "Deal Name": "SWI", "Fund I Expenses": "", "Fund II Expenses": "", "Total Expenses": null, "EBITDA ($m)": null },
  { "Deal Name": "Other Miscellaneous Deals", "Fund I Expenses": "", "Fund II Expenses": "", "Total Expenses": null, "EBITDA ($m)": null },
  { "Deal Name": "Volta Insight / Atom Power", "Fund I Expenses": "", "Fund II Expenses": "", "Total Expenses": null, "EBITDA ($m)": null },
  { "Deal Name": "McQ", "Fund I Expenses": "$9,865.91", "Fund II Expenses": "$-", "Total Expenses": 9865.91, "EBITDA ($m)": 5 },
  { "Deal Name": "Remtec", "Fund I Expenses": "$750.11", "Fund II Expenses": "$-", "Total Expenses": 750.11, "EBITDA ($m)": 5 },
  { "Deal Name": "Tri-Mack (see also Project Patriot)", "Fund I Expenses": "$8,386.65", "Fund II Expenses": "$-", "Total Expenses": 8386.65, "EBITDA ($m)": 6 },
  { "Deal Name": "C-Flex", "Fund I Expenses": "$1,584.91", "Fund II Expenses": "$-", "Total Expenses": 1584.91, "EBITDA ($m)": 7 },
  { "Deal Name": "Ironwave", "Fund I Expenses": "$-", "Fund II Expenses": "$10,935.79", "Total Expenses": 10935.79, "EBITDA ($m)": 8 },
  { "Deal Name": "Control Panels USA", "Fund I Expenses": "$-", "Fund II Expenses": "$12,861.54", "Total Expenses": 12861.54, "EBITDA ($m)": 5 },
  { "Deal Name": "Nyati Services", "Fund I Expenses": "$-", "Fund II Expenses": "$14,976.99", "Total Expenses": 14976.99, "EBITDA ($m)": 8 },
  { "Deal Name": "Compotech", "Fund I Expenses": "$-", "Fund II Expenses": "$264.91", "Total Expenses": 264.91, "EBITDA ($m)": 9 },
  { "Deal Name": "Precise Metal Products", "Fund I Expenses": "$-", "Fund II Expenses": "$1,250.00", "Total Expenses": 1250, "EBITDA ($m)": 11 },
  { "Deal Name": "Torrent Photonics / Resistance Optics", "Fund I Expenses": "$-", "Fund II Expenses": "$4,401.07", "Total Expenses": 4401.07, "EBITDA ($m)": 15 },
  { "Deal Name": "Creare", "Fund I Expenses": "$-", "Fund II Expenses": "$25,781.36", "Total Expenses": 25781.36, "EBITDA ($m)": 17 },
  { "Deal Name": "Mosaic Company", "Fund I Expenses": "$-", "Fund II Expenses": "$2,800.00", "Total Expenses": 2800, "EBITDA ($m)": 18 },
  { "Deal Name": "Industrial Repair Services", "Fund I Expenses": "$-", "Fund II Expenses": "$11,308.98", "Total Expenses": 11308.98, "EBITDA ($m)": 19 },
  { "Deal Name": "EKN", "Fund I Expenses": "$-", "Fund II Expenses": "$7,350.00", "Total Expenses": 7350, "EBITDA ($m)": 20 },
  { "Deal Name": "Lake Shore Electric", "Fund I Expenses": "$-", "Fund II Expenses": "$25,774.32", "Total Expenses": 25774.32, "EBITDA ($m)": 20 },
  { "Deal Name": "Ameritex", "Fund I Expenses": "$-", "Fund II Expenses": "$15,576.53", "Total Expenses": 15576.53, "EBITDA ($m)": 23 },
  { "Deal Name": "Edko", "Fund I Expenses": "$-", "Fund II Expenses": "$91.01", "Total Expenses": 91.01, "EBITDA ($m)": 24 },
  { "Deal Name": "Advanced Industrial Devices", "Fund I Expenses": "$-", "Fund II Expenses": "$61.18", "Total Expenses": 61.18, "EBITDA ($m)": 25 },
  { "Deal Name": "Micro Precision", "Fund I Expenses": "$-", "Fund II Expenses": "$1,666.06", "Total Expenses": 1666.06, "EBITDA ($m)": 30 },
  { "Deal Name": "GS Precision", "Fund I Expenses": "$-", "Fund II Expenses": "$750.09", "Total Expenses": 750.09, "EBITDA ($m)": 40 },
  { "Deal Name": "ZUKO", "Fund I Expenses": "", "Fund II Expenses": "", "Total Expenses": null, "EBITDA ($m)": null },
];

export const deadDealsTable: DiscoveryTable = {
  name: "dead_deals_report_dead_deals",
  columns: [...deadDealsColumns],
  rows: deadDealsRows,
  columnTypes: { ...deadDealsColumnTypes },
};

// The 4 ledger rows for Ironwave — the detail that should foot to the report's
// $10,935.79 but only sums to $7,731.78 (the $3,204.01 gap).
export const ironwaveLedgerRows: Record<string, unknown>[] = [
  { Description: "American Airlines - 3/24/26 GB Flight IAD - LAS (split 50% Ironwave / 50% ISC West)", Amount: 537.1 },
  { Description: "Reclass Dead Deals transactions to Funds - Write off - Ironwave: Meals While Traveling", Amount: 81.7 },
  { Description: "Reclass Dead Deals transactions to Funds - Write off - Ironwave: Professional Fees", Amount: 3289.51 },
  { Description: "Reclass Dead Deals transactions to Funds - Write off - Ironwave: Travel", Amount: 3823.47 },
];

// The commitment split (Fund I family / Fund II family), from the "Current Split"
// row of dead_deals_report_estimated_commitments.
export const commitmentSplit = [
  { entity: "Fund I family", percent: 38.16 },
  { entity: "Fund II family", percent: 61.84 },
];

// ── Golden numbers (hand-verified) ────────────────────────────────────────────

export const GOLDEN = {
  fundITotal: 20587.58,
  fundIITotal: 135849.83,
  totalExpenses: 156437.41,
  // Ironwave: schedule $10,935.79 vs ledger detail $7,731.78 → $3,204.01 under-booked.
  ironwaveSchedule: 10935.79,
  ironwaveLedger: 7731.78,
  ironwaveVariance: -3204.01,
  // Commitment split of the total schedule expenses, to the cent (residual on the largest share).
  splitFundI: 59696.52,
  splitFundII: 96740.89,
};
