// Deterministic, type-aware fake value generator — no external dependency.
//
// Given a real sensitive value, produces a realistic, same-type stand-in that is
// stable across processes (seeded by a hash of the input) so masking/unmasking
// round-trips even before the mapping is persisted. Realistic replacements keep
// data semantically meaningful for the LLM (a name stays a name, a phone stays a
// phone) unlike opaque `<eN>`/`<aN>` tokens.
//
// Classification lives here (not in autoMask.ts) so the generator has no
// dependency on the knowledge store — pure functions only.

// ── Value classification (deterministic regex) ───────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SSN_RE = /^\d{3}-\d{2}-\d{4}$/;
const EIN_RE = /^\d{2}-\d{7}$/;
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

/** Legal-entity suffix → a company/organization name (e.g. "Meridian Europe GmbH"). */
const ORG_SUFFIX_RE =
  /\b(gmbh|g\.?m\.?b\.?h|ag|a\.?g|kg|ohg|sa|s\.?a\.?|sl|s\.?l\.?|sarl|bv|n\.?v\.?|pty|ltd|limited|plc|llc|llp|inc|incorporated|corp|corporation|co\.?|lp|spa|s\.?p\.?a\.?|as|oy|ab|kft|zrt)\b\.?$/i;

/**
 * Broader entity-suffix list used ONLY for fake generation of manually-entered
 * privacy-map names (companies like "First National Bank", "Johnson & Partners").
 * Kept separate from ORG_SUFFIX_RE so automatic data discovery does not start
 * masking ordinary financial terms ("Working Capital", "Trust", etc.).
 */
const BROAD_ORG_SUFFIX_RE =
  /\b(industries|partners|group|holdings|associates|assoc|bank|trust|capital|ventures|solutions|consulting|enterprises|systems|services|resources|intl|international|worldwide|global|agency|coop|foundation|institute|university|univ)\b\.?$/i;

/** Street-suffix → an address (e.g. "Pine ln", "510 Main St"). */
const STREET_SUFFIX_RE =
  /\b(st|street|ave|avenue|rd|road|ln|lane|dr|drive|blvd|boulevard|way|ct|court|pl|place|ter|terrace|hwy|highway|sq|square|pkwy|parkway|cir|circle)\b\.?/i;

/** Dates are numeric-ish, never PII — keep them unmasked. */
function isDateLike(v: string): boolean {
  const t = v.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t);
}

/** Money/amount shapes are financial values, not PII — keep them unmasked. */
function isMoneyLike(v: string): boolean {
  let t = v.trim();
  if (!t) return false;
  if (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1).trim();
  if (!/^[-+]?\s*[$€£¥]?\s*[\d,.]+$/.test(t)) return false;
  return /[$€£¥]/.test(t) || t.includes(",") || t.includes(".");
}

/** Luhn checksum — real card numbers pass; arbitrary ID numbers almost never do. */
function luhnCheck(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function isPhoneLike(v: string): boolean {
  const t = v.trim();
  if (!t || isDateLike(t) || isMoneyLike(t)) return false;
  if (t.includes(".")) return false;
  const digits = t.replace(/[\s()+-]/g, "");
  if (!/^\d{7,15}$/.test(digits)) return false;
  if (t.startsWith("+") || /[\s()-]/.test(t)) return true;
  return digits.length === 10 || digits.length === 11;
}

function isCreditCard(v: string): boolean {
  const digits = v.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  return luhnCheck(digits);
}

function isOrgLike(v: string): boolean {
  return ORG_SUFFIX_RE.test(v.trim());
}

/** Street address: a street suffix as the final token plus ≥2 tokens total. */
function isAddressLike(v: string): boolean {
  const t = v.trim();
  if (!t || isDateLike(t) || isMoneyLike(t) || isPhoneLike(t)) return false;
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  return STREET_SUFFIX_RE.test(tokens[tokens.length - 1] ?? "");
}

/** Classify a whole value as a structured-PII/org/address entity, or null. */
export function detectValueType(v: string): string | null {
  if (EMAIL_RE.test(v)) return "email";
  if (SSN_RE.test(v)) return "ssn";
  if (EIN_RE.test(v)) return "ein";
  if (IBAN_RE.test(v)) return "iban";
  if (isCreditCard(v)) return "card";
  if (isPhoneLike(v)) return "phone";
  if (isOrgLike(v)) return "name";
  if (isAddressLike(v)) return "address";
  return null;
}

// ── Deterministic PRNG (mulberry32) seeded by a string hash ──────────────────

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: () => number, arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

function digit(rnd: () => number): string {
  return String(Math.floor(rnd() * 10));
}

// ── Word banks ────────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph",
  "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Cliff", "Diane", "Marcus",
  "Nina", "Paul", "Helen", "Steven", "Grace", "Edward", "Ruth", "Daniel", "Laura",
  "George", "Amy", "Kenneth", "Sharon", "Raymond", "Nancy", "Anthony", "Pamela",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
  "White", "Harris", "Clark", "Lewis", "Robinson", "Walker", "Young", "Hall",
  "Allen", "Wright", "King", "Scott", "Green", "Baker", "Adams", "Nelson",
  "Carter", "Mitchell", "Roberts", "Turner", "Phillips", "Campbell", "Parker",
  "Evans", "Edwards", "Collins", "Stewart",
];

const COMPANY_TERMS = [
  "Summit", "Harbor", "Pine", "Maple", "Cedar", "Iron", "North", "South", "East",
  "West", "Blue", "Red", "Golden", "Silver", "Bright", "Clear", "Crystal",
  "Stone", "Brook", "Crest", "Ridge", "Meadow", "Juniper", "Alder", "Birch",
  "Oak", "River", "Lake", "Coast", "Highland", "Granite", "Sable", "Falcon",
  "Meridian", "Atlas", "Beacon", "Titan", "Vertex", "Pioneer", "Sterling",
];

const STREET_NAMES = [
  "Main", "Oak", "Maple", "Cedar", "Pine", "Elm", "Sunset", "Lake", "Hill",
  "Park", "River", "Spring", "Willow", "Birch", "Highland", "Crest", "Meadow",
  "Juniper", "Aspen", "Cherry", "Spruce", "Locust", "Walnut", "Ash", "Beech",
  "Fir", "Magnolia", "Palm", "Sycamore", "Easy", "Central", "Union", "Church",
  "School", "Mill", "Bridge", "Market", "Grove", "Haven", "Fairview", "Shady",
  "Green", "Redwood", "Sequoia",
];

const STREET_SUFFIXES = [
  "St", "Ave", "Rd", "Ln", "Dr", "Blvd", "Way", "Ct", "Pl", "Ter", "Hwy",
  "Cir", "Pkwy",
];

const EMAIL_DOMAINS = ["example.com", "example.org", "example.net", "example.co"];

const IBAN_COUNTRY_CODES = [
  "DE", "FR", "GB", "NL", "ES", "IT", "BE", "SE", "NO", "DK", "FI", "AT", "CH",
  "PT", "IE",
];

// ── Per-type fake generation ─────────────────────────────────────────────────

function fakeSsn(rnd: () => number): string {
  return `${digit(rnd)}${digit(rnd)}${digit(rnd)}-${digit(rnd)}${digit(rnd)}-${digit(rnd)}${digit(rnd)}${digit(rnd)}${digit(rnd)}`;
}

function fakeEin(rnd: () => number): string {
  return `${digit(rnd)}${digit(rnd)}-${digit(rnd)}${digit(rnd)}${digit(rnd)}${digit(rnd)}${digit(rnd)}${digit(rnd)}${digit(rnd)}`;
}

function fakeIban(rnd: () => number): string {
  const cc = pick(rnd, IBAN_COUNTRY_CODES);
  let bban = "";
  for (let i = 0; i < 18; i++) bban += digit(rnd);
  const check = `${digit(rnd)}${digit(rnd)}`;
  return `${cc}${check}${bban.replace(/(.{4})/g, "$1 ").trim()}`;
}

/** Luhn-valid card number of the same digit length as the input. */
function fakeCard(rnd: () => number, length: number): string {
  const len = Math.max(13, Math.min(19, length || 16));
  let body = "";
  for (let i = 0; i < len - 1; i++) body += digit(rnd);
  for (let d = 0; d <= 9; d++) {
    if (luhnCheck(body + d)) return body + d;
  }
  return body + "0";
}

/** Format-preserving phone: digits replaced, separators kept. */
function fakePhone(rnd: () => number, real: string): string {
  let out = "";
  for (const ch of real) {
    out += /\d/.test(ch) ? digit(rnd) : ch;
  }
  return out;
}

function fakeEmail(rnd: () => number): string {
  const first = pick(rnd, FIRST_NAMES).toLowerCase();
  const last = pick(rnd, LAST_NAMES).toLowerCase();
  return `${first}.${last}@${pick(rnd, EMAIL_DOMAINS)}`;
}

export function isOrgSuffix(word: string): boolean {
  return ORG_SUFFIX_RE.test(word) || BROAD_ORG_SUFFIX_RE.test(word);
}

/** Company/organization name — preserve the legal suffix, fake the rest. */
function fakeOrgName(rnd: () => number, real: string): string {
  const tokens = real.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return pick(rnd, COMPANY_TERMS) + " " + pick(rnd, LAST_NAMES);
  const lastIdx = tokens.length - 1;
  return tokens
    .map((t, i) => {
      if (i === lastIdx && /^[A-Za-z]/.test(t) && isOrgSuffix(t)) return t;
      if (!/^[A-Za-z]/.test(t)) return t; // keep &, /, ., numbers
      return pick(rnd, COMPANY_TERMS);
    })
    .join(" ");
}

/** Street address — keep house number + suffix shape, fake the street name. */
function fakeAddress(rnd: () => number, real: string): string {
  const tokens = real.split(/\s+/).filter(Boolean);
  const lastIdx = tokens.length - 1;
  return tokens
    .map((t, i) => {
      if (/^\d+[A-Za-z]?$/.test(t)) return t; // house number
      if (i === lastIdx) return pick(rnd, STREET_SUFFIXES);
      if (!/^[A-Za-z]/.test(t)) return t;
      return pick(rnd, STREET_NAMES);
    })
    .join(" ");
}

/** Person name — first token becomes a first name, the rest surnames. */
function fakePersonName(rnd: () => number, real: string): string {
  const tokens = real.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return `${pick(rnd, FIRST_NAMES)} ${pick(rnd, LAST_NAMES)}`;
  return tokens
    .map((t, i) => {
      if (!/^[A-Za-z]/.test(t)) return t; // keep punctuation/initials
      return i === 0 ? pick(rnd, FIRST_NAMES) : pick(rnd, LAST_NAMES);
    })
    .join(" ");
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Generate a stable fake replacement for a real value. `salt` lets callers
 * retry when the produced fake collides with one already in use.
 */
export function generateFakeValue(real: string, salt = 0): string {
  const seed = hashString(`${real}\u0000${salt}`);
  const rnd = mulberry32(seed);
  const v = real.trim();
  const type = detectValueType(v);
  switch (type) {
    case "email":
      return fakeEmail(rnd);
    case "ssn":
      return fakeSsn(rnd);
    case "ein":
      return fakeEin(rnd);
    case "iban":
      return fakeIban(rnd);
    case "card":
      return fakeCard(rnd, v.replace(/[\s-]/g, "").length);
    case "phone":
      return fakePhone(rnd, v);
    case "name":
      return fakeOrgName(rnd, v);
    case "address":
      return fakeAddress(rnd, v);
    default:
      // Unclassified (e.g. NER-discovered person names, or manual entities).
      // Use the broad suffix list to keep company names looking like companies.
      return BROAD_ORG_SUFFIX_RE.test(v) ? fakeOrgName(rnd, v) : fakePersonName(rnd, v);
  }
}
