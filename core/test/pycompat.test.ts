import { describe, expect, it } from "vitest";
import { formatFixed, parseIsoDate, round2, roundN, truthy } from "../src/pyCompat";

describe("Python-compatible numeric helpers", () => {
  it("round2 rounds exact ties to even like Python round(x, 2)", () => {
    expect(round2(0.125)).toBe(0.12);
    expect(round2(0.375)).toBe(0.38);
    expect(round2(2.675)).toBe(2.67); // binary value is below the tie
    expect(round2(1.005)).toBe(1);
    expect(round2(-0.125)).toBe(-0.12);
    expect(round2(24.995)).toBe(25); // Python: round(24.995, 2) == 25.0
  });
  it("formatFixed matches f'{x:.0f}' including ties", () => {
    expect(formatFixed(0.5, 0)).toBe("0");
    expect(formatFixed(1.5, 0)).toBe("2");
    expect(formatFixed(2.5, 0)).toBe("2");
    expect(formatFixed(19.5, 0)).toBe("20");
    expect(formatFixed(337.2, 0)).toBe("337");
  });
  it("roundN", () => {
    expect(roundN(0.25, 1)).toBe(0.2);
    expect(roundN(0.35, 1)).toBe(0.3);
    expect(roundN(10, 1)).toBe(10);
  });
  it("truthy follows Python rules", () => {
    expect([null, undefined, 0, "", [], {}, false].map(truthy)).toEqual(Array(7).fill(false));
    expect([1, "a", [0], { a: 1 }, true].map(truthy)).toEqual(Array(5).fill(true));
  });
  it("parseIsoDate accepts valid and rejects impossible dates", () => {
    expect(parseIsoDate("2026-09-30")).toEqual({ year: 2026, month: 9, day: 30 });
    expect(() => parseIsoDate("2026-02-30")).toThrow(/Invalid isoformat/);
    expect(() => parseIsoDate("nope")).toThrow(/Invalid isoformat/);
  });
});
