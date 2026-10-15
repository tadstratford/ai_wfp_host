// Entity-key extraction — pure, format-agnostic helpers.
//
// An "entity key" is the stable identifier shared by an account line and its
// memo/description line (e.g. "IBVK147 BVK Venture 2014, L.P. - TTVII Series").
// The longest-common-token-run is the general mechanism: it needs no knowledge
// of the prefix/suffix structure, only that the identifier is a contiguous run
// of identical tokens in both strings.

function tokenize(s: string): string[] {
  return (s ?? "").trim().split(/\s+/).filter(Boolean);
}

/** A token that is pure punctuation ("-", ".", ",", "()", …) and carries no
 *  identifier value on its own — used to trim separators off a run's edges. */
function isSeparatorToken(t: string): boolean {
  return /^[^\w]+$/.test(t);
}

/** Longest contiguous run of identical whitespace-separated tokens shared by
 *  `a` and `b`, with leading/trailing separator tokens ("-", ":", …) trimmed.
 *  Returns null when the run is too short to be a meaningful identifier
 *  (< 2 tokens or < 6 chars). */
export function longestCommonTokenRun(a: string, b: string): string | null {
  const A = tokenize(a);
  const B = tokenize(b);
  let best: string[] = [];
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < B.length; j++) {
      let k = 0;
      while (i + k < A.length && j + k < B.length && A[i + k] === B[j + k]) {
        k++;
      }
      if (k > best.length) best = A.slice(i, i + k);
    }
  }
  while (best.length > 0 && isSeparatorToken(best[0])) best.shift();
  while (best.length > 0 && isSeparatorToken(best[best.length - 1])) best.pop();
  if (best.length < 2) return null;
  const s = best.join(" ");
  return s.length >= 6 ? s : null;
}
