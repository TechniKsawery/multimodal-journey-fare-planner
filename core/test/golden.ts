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
