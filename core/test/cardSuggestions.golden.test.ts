// Golden test: BahnCard suggestion per itinerary vs the Python oracle (tools/golden/generate_places.py).
import { describe, expect, it } from "vitest";
import golden from "../golden/card_suggestions.json";
import { dbDistanceKm, dbFlexpreisUpperBoundTotal, suggestBahncardForItinerary } from "../src/routing/cardSuggestions";
import { LegMode, makeItinerary, makeLeg, makePricedLeg, type Leg } from "../src/routing/model";
import { round2 } from "../src/pyCompat";
import { canonical, firstDiff, fnv1a64 } from "./golden";

const D = new Date(Date.UTC(2026, 11, 1, 8, 0));
const E = new Date(Date.UTC(2026, 11, 1, 10, 0));
type P = [number, number];
const leg = (mode: LegMode, carrier: string, km: number | null, o: P, d: P): Leg =>
  makeLeg({
    mode,
    origin_name: "A",
    destination_name: "B",
    depart: D,
    arrive: E,
    carrier_name: carrier,
    distance_km: km,
    extra: { origin_lat: o[0], origin_lon: o[1], destination_lat: d[0], destination_lon: d[1] },
  });

const HAMM: P = [51.6781, 7.8083];
const BERLIN: P = [52.5251, 13.3694];
const MUNICH: P = [48.1403, 11.5601];
const WARSAW: P = [52.2288, 21.0033];
const LUBLIN: P = [51.2465, 22.5684];
const CATALOGUE: Record<string, Leg> = {
  db300: leg(LegMode.RAIL, "DB Fernverkehr AG", 300, HAMM, BERLIN),
  db700: leg(LegMode.RAIL, "Deutsche Bahn", 700, BERLIN, MUNICH),
  db_short: leg(LegMode.RAIL, "DB", 120, HAMM, HAMM),
  db_cross: leg(LegMode.RAIL, "DB Fernverkehr AG", 570, BERLIN, WARSAW),
  db_nodist: leg(LegMode.RAIL, "DB Fernverkehr AG", null, HAMM, BERLIN),
  db_zero: leg(LegMode.RAIL, "DB Fernverkehr AG", 0, HAMM, BERLIN),
  ic_pl: leg(LegMode.RAIL, "PKP Intercity", 400, WARSAW, LUBLIN),
  regio_de: leg(LegMode.RAIL, "DB Regio AG NRW", 100, HAMM, HAMM),
  flix: leg(LegMode.BUS, "FlixBus", 500, BERLIN, MUNICH),
  flight: leg(LegMode.FLIGHT, "Lufthansa", 800, BERLIN, MUNICH),
};
const KEYS = golden.keys as string[];
const SETTINGS = golden.settings as { age: number | null; journeys: number; existing: string | null; ref: string }[];

function sequences(): string[][] {
  let acc: string[][] = [[]];
  let layer: string[][] = [[]];
  for (let n = 1; n <= 3; n++) {
    layer = layer.flatMap((s) => KEYS.map((k) => [...s, k]));
    acc = acc.concat(layer);
  }
  return acc;
}

function cardRow(keys: string[], s: (typeof SETTINGS)[number]): unknown[] {
  const it = makeItinerary({
    variant_name: "x",
    legs: keys.map((k) => makePricedLeg({ leg: CATALOGUE[k], amount: 0, currency: "EUR", price_type: "szacunek" })),
    total_price_pln: 0,
    total_duration_min: 0,
    num_transfers: 0,
  });
  const sug = suggestBahncardForItinerary(it, s.age, s.journeys, s.existing, s.ref);
  return [
    round2(dbDistanceKm(it)),
    dbFlexpreisUpperBoundTotal(it),
    sug.map((c) => [c.variant_key, c.cena_karty, c.cena_biletu_bez_karty, c.cena_biletu_z_karta, c.oszczednosc_rocznie, c.journeys_needed_to_break_even, c.rekomendowana, c.opis]),
  ];
}

describe("BahnCard suggestion per itinerary vs the oracle", () => {
  it("named cases", () => {
    for (const n of golden.named as unknown as { keys: string[]; setting: number; result: unknown[] }[]) {
      expect(firstDiff(cardRow(n.keys, SETTINGS[n.setting]), n.result)).toBeNull();
    }
  });

  it("the whole grid has the oracle's fingerprint", () => {
    const seqs = sequences();
    const results = SETTINGS.flatMap((s) => seqs.map((k) => cardRow(k, s)));
    expect(results.length).toBe(golden.count);
    expect(results.filter((r) => (r[2] as unknown[]).length > 0).length).toBe(golden.nonempty);
    expect(fnv1a64(canonical(results))).toBe(golden.hash);
  });

  it("no DB leg or a cross-border leg means no suggestion", () => {
    expect(cardRow(["ic_pl", "flix", "flight"], SETTINGS[0])[2]).toEqual([]);
    expect(cardRow(["db_cross"], SETTINGS[0])[2]).toEqual([]);
  });
});
