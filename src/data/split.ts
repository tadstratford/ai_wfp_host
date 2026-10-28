// Deterministic amount splitting — pure functions, no app imports.
//
// Splits a total across entities by percentage (cents, residual on the largest
// share so the split ties exactly). Lifted out of the QBO allocation capability
// so the data-health rule evaluator (Layer C "measure") can reuse it without
// depending on a capability module.

export interface SplitShare {
  entity: string;
  amount: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Split a total across entities by percentage. Rounds each share to cents and
 * puts the rounding residual on the largest share so the split ties exactly.
 */
export function splitAmount(
  total: number,
  percentages: { entity: string; percent: number }[],
): SplitShare[] {
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
