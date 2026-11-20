// Golden test: Deutschlandticket / BahnCard 100 rule vs the Python oracle (tools/golden/generate_deutschlandticket.py).
import { describe, expect, it } from "vitest";
import golden from "../golden/deutschlandticket.json";
import { defaultProfile, type DiscountProfile } from "../src/fares/model";
import { itineraryToLegs } from "../src/routing/motis";
import { priceVerified } from "../src/routing/model";
import { priceLeg } from "../src/routing/pricing";
import { round2 } from "../src/pyCompat";
import { canonical, firstDiff, fnv1a64, productCases } from "./golden";

type Stop = [string, number, number];
const STOPS = golden.stops as unknown as Record<string, Stop>;
const PAIRS = golden.pairs as unknown as string[][];
const PROFILES = golden.profiles as unknown as Partial<DiscountProfile>[];

function summary(profile: number, mode: string, agency: string, route: string, pair: string[]): unknown[] {
  const [a, b] = pair.map((k) => STOPS[k]);
  const raw = {
    legs: [
      {
        mode,
        agencyName: agency,
        routeShortName: route,
        from: { name: a[0], lat: a[1], lon: a[2] },
        to: { name: b[0], lat: b[1], lon: b[2] },
        startTime: "2026-12-01T06:00:00Z",
        endTime: "2026-12-01T07:00:00Z",
      },
    ],
  };
  const [leg] = itineraryToLegs(raw as never);
  const priced = priceLeg(leg, { ...defaultProfile(), ...PROFILES[profile] });
  return [
    round2(priced.amount),
    priced.currency,
    priced.price_type,
    priceVerified(priced),
    (priced.carrier as string | null) ?? null,
    Boolean(priced.breakdown["deutschlandticket"]),
    (priced.breakdown["podstawa"] as string | undefined) ?? null,
  ];
}

describe("Deutschlandticket / BahnCard 100 vs the oracle", () => {
  it("named cases", () => {
    for (const n of golden.named as unknown as { case: Record<string, any>; result: unknown[] }[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
      const c = n.case;
      const got = summary(c["profile"], c["mode"], c["agency"], c["route"], PAIRS[c["pair"]]);
      expect(firstDiff(got, n.result)).toBeNull();
    }
  });

  it("the whole grid has the oracle's fingerprint", () => {
    const cases = productCases([
      ["profile", PROFILES.map((_, i) => i)],
      ["mode", golden.modes],
      ["agency", golden.agencies],
      ["route", golden.routes],
      ["pair", PAIRS.map((_, i) => i)],
    ]);
    const results = cases.map((c) => summary(c.profile as number, c.mode as string, c.agency as string, c.route as string, PAIRS[c.pair as number]));
    expect(results.length).toBe(golden.count);
    expect(results.filter((r) => r[5]).length).toBe(golden.covered_count);
    expect(fnv1a64(canonical(results))).toBe(golden.hash);
  });

  it("only holders get 0 EUR, and only inside the documented scope", () => {
    expect(summary(0, "REGIONAL_FAST_RAIL", "DB Regio AG NRW", "RE 3", PAIRS[0])[0]).toBeGreaterThan(0);
    expect(summary(1, "REGIONAL_FAST_RAIL", "DB Regio AG NRW", "RE 3", PAIRS[0]).slice(0, 2)).toEqual([0, "EUR"]);
    expect(summary(1, "HIGHSPEED_RAIL", "DB Fernverkehr AG", "ICE 845", PAIRS[1])[5]).toBe(false);
    expect(summary(1, "COACH", "FlixBus", "", PAIRS[1])[5]).toBe(false);
  });
});
