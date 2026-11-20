// Helpers that reproduce the exact numeric/text behaviour of the Python oracle.
// The Python code is the specification, so rounding and formatting must match it digit for digit.

/** Python `round(x, 2)`: half-to-even on the exact binary value (JS Math.round differs). */
export function round2(x: number): number {
  return Number(formatFixed(x, 2));
}

/** Python `round(x, digits)` for digits >= 0 (same exact-value, half-to-even rule as {@link round2}). */
export function roundN(x: number, digits: number): number {
  return Number(formatFixed(x, digits));
}

/** Python `f"{x:.{digits}f}"`: exact decimal expansion, ties rounded to even. */
export function formatFixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) return String(x);
  const probe = x.toFixed(Math.min(digits + 30, 100));
  const tail = probe.slice(probe.length - 30);
  const isTie = tail[0] === "5" && /^50*$/.test(tail);
  if (!isTie) return x.toFixed(digits);
  // Exact tie: JS toFixed rounds half away from zero, Python rounds half to even.
  const truncated = probe.slice(0, probe.length - 30);
  const lastDigit = Number(truncated.replace("-", "").replace(".", "").slice(-1));
  if (lastDigit % 2 === 0) return truncated.endsWith(".") ? truncated.slice(0, -1) : truncated;
  return x.toFixed(digits);
}

/** Python `str(list_of_strings)` as used in error messages, e.g. ['a', 'b']. */
export function pyList(items: readonly string[]): string {
  return `[${items.map((s) => `'${s}'`).join(", ")}]`;
}

/** Python `repr(str)` for plain strings (single quotes unless the string contains one). */
export function pyRepr(s: string): string {
  if (s.includes("'") && !s.includes('"')) return `"${s}"`;
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Python `date.fromisoformat("YYYY-MM-DD")`; throws on malformed or impossible dates. */
export function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new ValueError(`Invalid isoformat string: ${pyRepr(value)}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(2000, month - 1, day));
  probe.setUTCFullYear(year);
  if (year < 1 || month < 1 || month > 12 || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new ValueError(`Invalid isoformat string: ${pyRepr(value)}`);
  }
  return { year, month, day };
}

/** Counterpart of Python `ValueError`: the calculators signal bad input with it, the golden vectors record its message. */
export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

/** Python `str(float)`: integral floats keep the trailing ".0" (1.0 -> "1.0"). Only for values that are floats in the data. */
export function pyFloatStr(x: number): string {
  return Number.isInteger(x) ? `${x}.0` : String(x);
}

/** Python truthiness (empty dict/list/string, 0, null are falsy) — JS treats {} and [] as truthy. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/**
 * Keys of a data object in the order they appear in the JSON file. JS moves integer-like keys
 * ("25", "50") in front of the others, Python keeps file order; in this repo's data files the
 * text keys come first and the numeric ones follow in ascending order, so that order is restored.
 */
export function fileOrderKeys(obj: object): string[] {
  const keys = Object.keys(obj);
  const isIndex = (k: string) => /^(0|[1-9]\d*)$/.test(k);
  return [...keys.filter((k) => !isIndex(k)), ...keys.filter(isIndex)];
}

/** Python `round(x)` (no digits): half to even, returns an integer. */
export function roundInt(x: number): number {
  return Number(formatFixed(x, 0));
}

/** Compare two ISO dates (YYYY-MM-DD) like Python `date` objects: negative, 0 or positive. */
export function compareIsoDates(a: string, b: string): number {
  const x = parseIsoDate(a);
  const y = parseIsoDate(b);
  return x.year - y.year || x.month - y.month || x.day - y.day;
}

// JS `\b` is ASCII-only even with the u flag; Python's `\w` is Unicode-aware. These lookarounds are the
// Unicode word boundaries (start / end of a run of letters, digits and underscore).
export const WB_START = "(?<![\\p{L}\\p{N}_])";
export const WB_END = "(?![\\p{L}\\p{N}_])";

export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Python `any(re.search(rf"(?<!\w){re.escape(k)}(?!\w)", text) for k in keywords)`: whole-word match. */
export function matchesAnyWord(text: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => wordRegex(k).test(text));
}

const WORD_REGEX_CACHE = new Map<string, RegExp>();
function wordRegex(keyword: string): RegExp {
  let re = WORD_REGEX_CACHE.get(keyword);
  if (!re) {
    re = new RegExp(`${WB_START}${escapeRegExp(keyword)}${WB_END}`, "u");
    WORD_REGEX_CACHE.set(keyword, re);
  }
  return re;
}
