/**
 * Deterministic date/date-range resolver for parameter extraction.
 *
 * Pure TypeScript, no dependencies. Maps natural-language date phrases in a
 * user request onto concrete "YYYY-MM-DD" strings. Ranges are computed against
 * `new Date()` (today), so results are deterministic for a fixed clock but move
 * as real time passes.
 */

export type DateRange = { start: string; end: string };

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const ISO_YEAR_MONTH = /\b(\d{4})-(\d{1,2})\b/;
const US_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;
const MONTH_KEYS = Object.keys(MONTHS).join("|");
const MONTH_YEAR = new RegExp(
  `\\b(${MONTH_KEYS})\\.?\\s+(\\d{4})\\b`,
  "i",
);
// "Month N" where N is a day (1-31, optional ordinal) or a year (>=1000).
const MONTH_NUM = new RegExp(
  `\\b(${MONTH_KEYS})\\.?\\s+(\\d{1,4})(?:st|nd|rd|th)?\\b`,
  "i",
);
const MONTH_NAME = new RegExp(
  `\\b(${Object.keys(MONTHS).join("|")})\\b\\.?`,
  "i",
);
const YEAR = /\b(19|20)\d{2}\b/;
const QUARTER = /\bq([1-4])\b(?:,?\s*(?:of\s+)?(19|20)?(\d{2}))?/i;
const FISCAL = /\bfy\s?(19|20)?(\d{2})\b/i;

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const c = startOfDay(d);
  c.setDate(c.getDate() + n);
  return c;
}

function addMonths(d: Date, n: number): Date {
  const c = startOfDay(d);
  c.setMonth(c.getMonth() + n);
  return c;
}

function addYears(d: Date, n: number): Date {
  const c = startOfDay(d);
  c.setFullYear(c.getFullYear() + n);
  return c;
}

function monthStart(y: number, m: number): Date {
  return new Date(y, m, 1);
}

function monthEnd(y: number, m: number): Date {
  return new Date(y, m + 1, 0);
}

function quarterBounds(y: number, q: number): DateRange {
  const start = new Date(y, (q - 1) * 3, 1);
  const end = new Date(y, q * 3, 0);
  return { start: fmt(start), end: fmt(end) };
}

function currentQuarter(today: Date): { y: number; q: number } {
  return { y: today.getFullYear(), q: Math.floor(today.getMonth() / 3) + 1 };
}

function shiftQuarter(y: number, q: number, n: number): { y: number; q: number } {
  const idx = y * 4 + (q - 1) + n;
  return { y: Math.floor(idx / 4), q: ((idx % 4) + 4) % 4 + 1 };
}

function weekBounds(today: Date, offsetWeeks: number): DateRange {
  const d = addDays(today, offsetWeeks * 7);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  const monday = addDays(d, -dow);
  return { start: fmt(monday), end: fmt(addDays(monday, 6)) };
}

function yearRange(y: number): DateRange {
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

function monthRange(y: number, m: number): DateRange {
  return { start: fmt(monthStart(y, m)), end: fmt(monthEnd(y, m)) };
}

/** Two explicit dates in the text ("from X to Y"). */
function explicitPair(text: string): DateRange | null {
  const iso = text.match(new RegExp(`${ISO_DATE.source}.*?${ISO_DATE.source}`));
  if (iso) {
    const a = new Date(+iso[1], +iso[2] - 1, +iso[3]);
    const b = new Date(+iso[4], +iso[5] - 1, +iso[6]);
    return { start: fmt(a), end: fmt(b) };
  }
  return null;
}

/** A single explicit date in the text. */
function explicitDate(text: string): Date | null {
  const iso = text.match(ISO_DATE);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);

  const us = text.match(US_DATE);
  if (us) {
    const mm = +us[1];
    const dd = +us[2];
    let yy = +us[3];
    if (yy < 100) yy += 2000;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)
      return new Date(yy, mm - 1, dd);
  }

  const my = text.match(MONTH_YEAR);
  if (my) return new Date(+my[2], MONTHS[my[1].toLowerCase()], 1);

  const mn = text.match(MONTH_NUM);
  if (mn) {
    const m = MONTHS[mn[1].toLowerCase()];
    const num = +mn[2];
    if (num >= 1000) return new Date(num, m, 1);
    const y = text.match(YEAR);
    return new Date(y ? +y[0] : new Date().getFullYear(), m, num);
  }

  const m = text.match(MONTH_NAME);
  if (m) {
    const y = text.match(YEAR);
    const year = y ? +y[0] : new Date().getFullYear();
    return new Date(year, MONTHS[m[1].toLowerCase()], 1);
  }

  const ym = text.match(ISO_YEAR_MONTH);
  if (ym) return new Date(+ym[1], +ym[2] - 1, 1);

  return null;
}

/**
 * Resolve a natural-language date *range* from free text. A lone date resolves
 * to a single-day range. Returns null when nothing date-like is found.
 */
export function resolveRange(text: string, now = new Date()): DateRange | null {
  const t = text.toLowerCase();
  const today = startOfDay(now);

  // Two explicit dates (a from/to span).
  const pair = explicitPair(text);
  if (pair) return pair;

  // "last N days/weeks/months/years" (trailing period ending today).
  const trailing = t.match(
    /\b(?:last|past)\s+(\d+)\s+(day|week|month|year|quarter)s?\b/,
  );
  if (trailing) {
    const n = +trailing[1];
    const unit = trailing[2];
    if (unit === "day") return { start: fmt(addDays(today, -(n - 1))), end: fmt(today) };
    if (unit === "week") return { start: fmt(addDays(today, -(n * 7 - 1))), end: fmt(today) };
    if (unit === "month") return { start: fmt(addMonths(today, -n)), end: fmt(addDays(addMonths(today, 0), -1)) };
    if (unit === "quarter") {
      const { y, q } = shiftQuarter(today.getFullYear(), Math.floor(today.getMonth() / 3) + 1, -n);
      return quarterBounds(y, q);
    }
    if (unit === "year") {
      return { start: fmt(addYears(today, -n)), end: fmt(addDays(today, 0)) };
    }
  }

  // "this/last/next <unit>" and bare "last <unit>" without a number.
  const rel = t.match(
    /\b(this|last|next|current)\s+(year|quarter|month|week|day)\b/,
  );
  if (rel) {
    const dir = rel[1];
    const unit = rel[2];
    const delta = dir === "last" ? -1 : dir === "next" ? 1 : 0;

    if (unit === "year") {
      const y = today.getFullYear() + delta;
      return yearRange(y);
    }
    if (unit === "quarter") {
      const { y, q } = shiftQuarter(
        today.getFullYear(),
        Math.floor(today.getMonth() / 3) + 1,
        delta,
      );
      return quarterBounds(y, q);
    }
    if (unit === "month") {
      const d = addMonths(today, delta);
      return monthRange(d.getFullYear(), d.getMonth());
    }
    if (unit === "week") return weekBounds(today, delta);
    if (unit === "day") return { start: fmt(addDays(today, delta)), end: fmt(addDays(today, delta)) };
  }

  // "today" / "yesterday" / "tomorrow".
  if (/\byesterday\b/.test(t)) return { start: fmt(addDays(today, -1)), end: fmt(addDays(today, -1)) };
  if (/\btomorrow\b/.test(t)) return { start: fmt(addDays(today, 1)), end: fmt(addDays(today, 1)) };
  if (/\btoday\b/.test(t)) return { start: fmt(today), end: fmt(today) };

  // Quarters: "Q3 2025" / "Q3".
  const q = t.match(QUARTER);
  if (q) {
    const qn = +q[1];
    let year = today.getFullYear();
    if (q[3]) {
      year = (q[2] ? +q[2] : 20) * 100 + +q[3];
      if (q[2] && +q[3] < 100) year = +`${q[2]}${q[3]}`;
    } else if (q[2] && q[3] === undefined) {
      // "q3 25" style handled above; ignore.
    }
    return quarterBounds(year, qn);
  }

  // Fiscal years: "FY2026" / "FY26" (calendar-year assumption).
  const fy = t.match(FISCAL);
  if (fy) {
    let year = +fy[2];
    if (fy[1]) year = +`${fy[1]}${fy[2]}`;
    else if (year < 100) year += 2000;
    return yearRange(year);
  }

  // "Month YYYY" or "Month" (current year).
  const my = t.match(MONTH_YEAR);
  if (my) return monthRange(+my[2], MONTHS[my[1].toLowerCase()]);

  const mn = t.match(MONTH_NAME);
  if (mn) {
    const y = t.match(YEAR);
    return monthRange(y ? +y[0] : today.getFullYear(), MONTHS[mn[1].toLowerCase()]);
  }

  // Bare year ("2025").
  const y = t.match(YEAR);
  if (y) return yearRange(+y[0]);

  // Bare "the <unit>" ("for the year", "the month") — current period. Placed
  // after the explicit year/month checks so "the year 2024" still resolves to
  // 2024 rather than the current year.
  const the = t.match(/\bthe\s+(year|quarter|month|week|day)\b/);
  if (the) {
    const unit = the[1];
    if (unit === "year") return yearRange(today.getFullYear());
    if (unit === "quarter") {
      const { y: qy, q } = currentQuarter(today);
      return quarterBounds(qy, q);
    }
    if (unit === "month") return monthRange(today.getFullYear(), today.getMonth());
    if (unit === "week") return weekBounds(today, 0);
    return { start: fmt(today), end: fmt(today) };
  }

  // A single explicit date → single-day range.
  const d = explicitDate(text);
  if (d) return { start: fmt(d), end: fmt(d) };

  return null;
}

/** Resolve a single date (for non-range date parameters). */
export function resolveDate(text: string, now = new Date()): string | null {
  const d = explicitDate(text);
  if (d) return fmt(d);

  const t = text.toLowerCase();
  const today = startOfDay(now);
  if (/\byesterday\b/.test(t)) return fmt(addDays(today, -1));
  if (/\btomorrow\b/.test(t)) return fmt(addDays(today, 1));
  if (/\btoday\b/.test(t)) return fmt(today);

  const range = resolveRange(text, now);
  if (range) return range.start;
  return null;
}
