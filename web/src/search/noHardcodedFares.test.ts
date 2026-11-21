import { describe, expect, it } from "vitest";

// Guard for the project's absolute rule: prices live in data/ with a source URL + verification
// date, never as literals in UI code. Flags fare-like numbers in web/src (non-test) sources.
const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("no hard-coded fares in web/src", () => {
  it("has no per-km rates, price tables or fare-currency literals", () => {
    const bad: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      text.split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (
          /\b\d+[.,]\d+\s*(zł|zl|PLN|EUR|€)\b/i.test(line) ||
          /\b\d+[.,]\d+\s*\/\s*km\b/i.test(line) ||
          /(rate|stawka|perKm|base_?fare|fares?)\s*[:=]\s*\{?\s*\d/i.test(line)
        ) {
          bad.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });
});
