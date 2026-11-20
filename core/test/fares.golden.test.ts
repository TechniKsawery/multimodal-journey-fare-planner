// The Python calculators are the specification: every golden case must reproduce exactly
// (amount, currency, price type, the full breakdown and the Polish notes text).
import { describe, expect, it } from "vitest";
import grids from "../golden/fares.grid.json";
import readable from "../golden/fares.json";
import { estimatePrice } from "../src/fares/calculator";
import { makeSegment, type Carrier, type DiscountProfile, type Segment } from "../src/fares/model";
import { capture, canonical, fnv1a64 } from "./golden";

interface Case {
  carrier: string;
  field: string | null;
  extra: Record<string, unknown>;
  value: number | null;
  profile: Partial<DiscountProfile>;
}

function build(c: Case): Segment {
  const fields: Record<string, unknown> = { ...c.extra };
  if (c.field) fields[c.field] = c.value;
  return makeSegment({
    carrier: c.carrier as Carrier,
    origin: "A",
    destination: "B",
    discounts: c.profile,
    ...fields,
  });
}

function oracleShape(c: Case): unknown {
  return capture(() => estimatePrice(build(c)));
}

describe("fares: readable golden cases (full expected output)", () => {
  it(`reproduces all ${(readable as unknown[]).length} cases`, () => {
    const failures: string[] = [];
    for (const raw of readable as unknown as (Case & { expect: unknown })[]) {
      const got = canonical(oracleShape(raw));
      const want = canonical(raw.expect);
      if (got !== want) {
        failures.push(`${raw.carrier} ${raw.field}=${raw.value} ${JSON.stringify(raw.extra)} ${JSON.stringify(raw.profile)}\n  want ${want}\n  got  ${got}`);
        if (failures.length >= 5) break;
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("fares: grid of fingerprints (carrier x extras x values x profiles)", () => {
  for (const grid of grids as unknown as {
    carrier: string;
    field: string | null;
    extras: Record<string, unknown>[];
    values: (number | null)[];
    profiles: Partial<DiscountProfile>[];
    hashes: string[];
  }[]) {
    it(`${grid.carrier}: ${grid.hashes.length} cases`, () => {
      let i = 0;
      const mismatches: string[] = [];
      for (const extra of grid.extras) {
        for (const value of grid.values) {
          for (const profile of grid.profiles) {
            const c: Case = { carrier: grid.carrier, field: grid.field, extra, value, profile };
            const got = fnv1a64(canonical(oracleShape(c)));
            if (got !== grid.hashes[i]) {
              mismatches.push(`${grid.field}=${value} ${JSON.stringify(extra)} ${JSON.stringify(profile)} -> ${canonical(oracleShape(c))}`);
            }
            i++;
          }
        }
      }
      expect(mismatches.slice(0, 3)).toEqual([]);
      expect(i).toBe(grid.hashes.length);
    });
  }
});
