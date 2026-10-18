/**
 * Deterministic allocation-journal computation — shared by the live `qbo` and
 * demo `qbodemo` capabilities. Pure arithmetic: split a total across entities
 * by percentage (cents, residual to the largest share), then emit balanced
 * debit/credit lines. No LLM — the model only reads, routes, and reviews.
 */

import type { WorkspaceSession } from "@backend/core/workspace/WorkspaceSession";

export interface AllocationLine {
  account: string;
  posting_type: "Debit" | "Credit";
  amount: number;
  class?: string;
  description?: string;
}

export interface AllocationShare {
  entity: string;
  amount: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Normalize a period to a month name: "2026-05" → "May", "05"/"5" → "May". */
export function monthLabel(period: string): string | null {
  const t = period.trim();
  if (MONTHS.includes(t)) return t;
  const yyyymm = t.match(/^(\d{4})-(\d{2})$/);
  if (yyyymm) {
    const idx = Number(yyyymm[2]) - 1;
    if (idx >= 0 && idx < 12) return MONTHS[idx];
  }
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return MONTHS[n - 1];
  return null;
}

/** Split a total across entities by percentage. Rounds each share to cents and
 *  puts the rounding residual on the largest share so the split ties exactly. */
export function splitAmount(
  total: number,
  percentages: { entity: string; percent: number }[],
): AllocationShare[] {
  const shares = percentages.map((p) => ({
    entity: p.entity,
    amount: round2((total * p.percent) / 100),
  }));
  const sum = round2(shares.reduce((s, x) => s + x.amount, 0));
  const residual = round2(total - sum);
  if (residual !== 0 && shares.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < shares.length; i++) {
      if (shares[i].amount > shares[maxIdx].amount) maxIdx = i;
    }
    shares[maxIdx].amount = round2(shares[maxIdx].amount + residual);
  }
  return shares;
}

/** Emit balanced journal lines: debit each entity's share of `debitAccount`
 *  (with the entity as `class`), credit `creditAccount` for the full total. */
export function computeAllocationLines(opts: {
  total: number;
  percentages: { entity: string; percent: number }[];
  debitAccount: string;
  creditAccount: string;
  description?: string;
}): AllocationLine[] {
  const shares = splitAmount(opts.total, opts.percentages);
  const lines: AllocationLine[] = shares.map((s) => ({
    account: opts.debitAccount,
    posting_type: "Debit",
    amount: round2(s.amount),
    class: s.entity,
    ...(opts.description ? { description: opts.description } : {}),
  }));
  lines.push({
    account: opts.creditAccount,
    posting_type: "Credit",
    amount: round2(opts.total),
    ...(opts.description ? { description: opts.description } : {}),
  });
  return lines;
}

export interface AllocationComputeInput {
  allocationSource: string;
  amountsSource: string;
  period: string;
  debitAccount: string;
  creditAccount: string;
  entityColumn?: string;
  periodColumn?: string;
  amountColumn?: string;
  description?: string;
}

export interface AllocationComputeResult {
  lines: AllocationLine[];
  total: number;
  percentages: { entity: string; percent: number }[];
}

/** Read the allocation table + amounts from the workspace, compute the balanced
 *  lines. Pure with respect to the inputs — no writes, no LLM. */
export function computeAllocation(
  ws: WorkspaceSession,
  input: AllocationComputeInput,
): AllocationComputeResult {
  const alloc = ws.getDataEntry(input.allocationSource);
  const amounts = ws.getDataEntry(input.amountsSource);
  if (!alloc || !Array.isArray(alloc.content_json)) {
    throw new Error(`Allocation source "${input.allocationSource}" not found or not a table.`);
  }
  if (!amounts || !Array.isArray(amounts.content_json)) {
    throw new Error(`Amounts source "${input.amountsSource}" not found or not a table.`);
  }

  const label = monthLabel(input.period);
  if (!label) {
    throw new Error(`Cannot interpret period "${input.period}". Use "YYYY-MM" or a month name.`);
  }

  const allocRows = alloc.content_json as Record<string, unknown>[];
  const amountRows = amounts.content_json as Record<string, unknown>[];

  const allocCols = Object.keys(allocRows[0] ?? {});
  const entityColumn =
    input.entityColumn ?? allocCols.find((c) => !MONTHS.includes(c)) ?? allocCols[0];
  if (!entityColumn) throw new Error(`No entity column found in "${input.allocationSource}".`);

  const periodColumn = input.periodColumn ?? "Month";
  const amountColumn = input.amountColumn ?? "Amount";

  let total = 0;
  for (const r of amountRows) {
    if (monthLabel(String(r[periodColumn] ?? "")) === label) {
      total += Number(r[amountColumn]) || 0;
    }
  }
  total = round2(total);

  const percentages = allocRows
    .map((r) => ({
      entity: String(r[entityColumn] ?? "").trim(),
      percent: Number(r[label]) || 0,
    }))
    .filter((p) => p.entity !== "");

  const lines = computeAllocationLines({
    total,
    percentages,
    debitAccount: input.debitAccount,
    creditAccount: input.creditAccount,
    description: input.description,
  });

  return { lines, total, percentages };
}
