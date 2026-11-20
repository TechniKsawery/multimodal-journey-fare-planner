// Shared helpers for tests that compare the TypeScript port with the Python oracle's golden vectors.
import { ValueError } from "../src/pyCompat";

/** JSON with sorted keys — the same canonical form tools/golden/golden_common.py produces. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}

/** 64-bit FNV-1a over UTF-8 bytes — the same fingerprint as golden_common.fnv1a64. */
export function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** Run `fn` and return the oracle's result shape: {ok: ...} or {error: message}. */
export function capture(fn: () => unknown): unknown {
  try {
    return { ok: fn() };
  } catch (e) {
    return { error: e instanceof ValueError ? e.message : "<non-ValueError>" };
  }
}

/** All combinations of the axes ([name, values] pairs); the last axis varies fastest (same as golden_common.product_cases). */
export function productCases(axes: [string, unknown[]][]): Record<string, unknown>[] {
  let acc: Record<string, unknown>[] = [{}];
  for (const [name, values] of axes) {
    acc = acc.flatMap((partial) => values.map((v) => ({ ...partial, [name]: v })));
  }
  return acc;
}

/** Path and values of the first difference between two JSON-like values (for readable failures). */
export function firstDiff(got: unknown, want: unknown, path = "$"): string | null {
  if (canonical(got) === canonical(want)) return null;
  if (Array.isArray(got) && Array.isArray(want) && got.length === want.length) {
    for (let i = 0; i < got.length; i++) {
      const d = firstDiff(got[i], want[i], `${path}[${i}]`);
      if (d) return d;
    }
  } else if (got && want && typeof got === "object" && typeof want === "object" && !Array.isArray(got) && !Array.isArray(want)) {
    for (const k of new Set([...Object.keys(got), ...Object.keys(want)])) {
      const d = firstDiff((got as Record<string, unknown>)[k], (want as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path}: want ${canonical(want)} got ${canonical(got)}`;
}
