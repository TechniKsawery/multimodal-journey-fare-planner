// Golden test: KD "Dresden Promotion" bundle vs the Python oracle (tools/golden/generate_kd_dresden.py).
import { describe, expect, it } from "vitest";
import golden from "../golden/kd_dresden.json";
import { defaultProfile } from "../src/fares/model";
import { itineraryToLegs } from "../src/routing/motis";
import { priceVerified } from "../src/routing/model";
import { applyKdDresdenPromotion, priceLeg } from "../src/routing/pricing";
import { round2 } from "../src/pyCompat";
import { canonical, firstDiff, fnv1a64 } from "./golden";

type Legs = [string, string, string, string][];
const STOPS = golden.stops as unknown as Record<string, [number, number]>;
const SHAPES = golden.shapes as unknown as Record<string, Legs>;

function run(origin: string, shape: string, age: number | null): unknown[] {
  const profile = { ...defaultProfile(), age };
  const t0 = Date.UTC(2026, 11, 1, 6, 0);
  const legs = SHAPES[shape].map(([carrier, mode, a0, b0], n) => {
    const a = a0 === "O" ? origin : a0;
    const b = b0 === "O" ? origin : b0;
    const start = new Date(t0 + n * 3600_000);
    const end = new Date(start.getTime() + 50 * 60_000);
    const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");
    const raw = {
      legs: [
        {
          mode,
          agencyName: carrier,
          routeShortName: "RE 2",
          from: { name: a, lat: STOPS[a][0], lon: STOPS[a][1] },
          to: { name: b, lat: STOPS[b][0], lon: STOPS[b][1] },
          startTime: iso(start),
          endTime: iso(end),
        },
      ],
    };
    return itineraryToLegs(raw as never)[0];
  });
  const priced = applyKdDresdenPromotion(
    legs,
    legs.map((l) => priceLeg(l, profile)),
    profile,
  );
  return priced.map((p) => [
    round2(p.amount),
    p.currency,
    p.price_type,
    priceVerified(p),
    Boolean(p.breakdown["kd_dresden_promotion"]),
    (p.breakdown["podstawa"] as string | undefined) ?? null,
    p.notes,
  ]);
}

describe("KD Dresden Promotion bundle vs the oracle", () => {
  it("named cases", () => {
    for (const n of golden.named as unknown as { case: [string, string, number | null]; result: unknown[] }[]) {
      expect(firstDiff(run(...n.case), n.result)).toBeNull();
    }
  });

  it("the whole grid has the oracle's fingerprint", () => {
    const results: unknown[] = [];
    for (const o of golden.origins) for (const s of golden.shape_order) for (const a of golden.ages) results.push(run(o, s, a));
    expect(results.length).toBe(golden.count);
    expect(results.filter((r) => (r as unknown[][]).some((x) => x[4])).length).toBe(golden.bundled);
    expect(fnv1a64(canonical(results))).toBe(golden.hash);
  });

  it("the bundle is never a confirmed price", () => {
    for (const row of run("Wrocław Główny", "kd_plus_dlb", null) as unknown[][]) {
      expect(row[2]).toBe("szacunek");
      expect(row[3]).toBe(false);
    }
  });
});
