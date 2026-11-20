// Golden tests for the pure routing parser (oracle: routing/motis_client.py).
import { describe, expect, it } from "vitest";
import golden from "../golden/motis.json";
import {
  allItineraries,
  decodePolyline,
  fastestItinerary,
  fewestTransfersItinerary,
  haversineKm,
  itineraryToLegs,
  matchAreas,
  TRACK_KM_GEOMETRY,
  TRACK_KM_STOPS,
  trackDistanceKm,
} from "../src/routing/motis";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const data = golden as unknown as Json;

/** Deep equality with a tolerance for floats (libm may differ in the last digits). */
function approxDiff(got: unknown, want: unknown, path = "$"): string | null {
  if (typeof want === "number" && typeof got === "number") {
    return Math.abs(got - want) <= 1e-6 + 1e-9 * Math.abs(want) ? null : `${path}: want ${want} got ${got}`;
  }
  if (Array.isArray(want) && Array.isArray(got)) {
    if (want.length !== got.length) return `${path}: length want ${want.length} got ${got.length}`;
    for (let i = 0; i < want.length; i++) {
      const d = approxDiff(got[i], want[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (want && got && typeof want === "object" && typeof got === "object") {
    const keys = new Set([...Object.keys(want as object), ...Object.keys(got as object)]);
    for (const k of keys) {
      const d = approxDiff((got as Json)[k], (want as Json)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return got === want ? null : `${path}: want ${JSON.stringify(want)} got ${JSON.stringify(got)}`;
}

const legJson = (l: ReturnType<typeof itineraryToLegs>[number]) => ({
  mode: l.mode,
  origin_name: l.origin_name,
  destination_name: l.destination_name,
  depart_ms: l.depart.getTime(),
  arrive_ms: l.arrive.getTime(),
  carrier_name: l.carrier_name,
  distance_km: l.distance_km,
  requires_walk: l.requires_walk,
  extra: l.extra,
});

describe("geometry", () => {
  it("decodes polylines like the oracle (precision 5/6/7, extremes, empty)", () => {
    for (const c of data.polylines as Json[]) expect(approxDiff(decodePolyline(c.encoded, c.precision), c.decoded), c.name).toBeNull();
  });
  it("haversine", () => {
    for (const c of data.haversine as Json[]) expect(approxDiff(haversineKm(...(c.in as [number, number, number, number])), c.km)).toBeNull();
  });
  it("labels", () => {
    expect(TRACK_KM_GEOMETRY).toBe(data.labels.geometry);
    expect(TRACK_KM_STOPS).toBe(data.labels.stops);
  });
});

describe("track distance", () => {
  for (const [name, want] of Object.entries(data.track as Json)) {
    it(name, () => {
      const it = data.itineraries[name] as Json;
      const leg = (it.legs as Json[]).find((l) => l.mode !== "WALK")!;
      expect(approxDiff(trackDistanceKm(leg), want)).toBeNull();
    });
  }
});

describe("itinerary -> legs", () => {
  for (const [name, want] of Object.entries(data.legs as Json)) {
    it(name, () => {
      const got = itineraryToLegs(data.itineraries[name]).map(legJson);
      expect(approxDiff(got, want.ok)).toBeNull();
    });
  }
  it("is JSON-safe (can cross a Web Worker boundary)", () => {
    const legs = itineraryToLegs(data.itineraries.transfer_with_walk);
    expect(structuredClone(legs)).toEqual(legs);
  });
});

describe("itinerary picking and areas", () => {
  it("fastest / fewest transfers, with and without `direct`", () => {
    const p = data.picks;
    expect(allItineraries(p.payload).map((i) => i.id)).toEqual(p.all_ids);
    expect(fastestItinerary(p.payload).id).toBe(p.fastest);
    expect(fewestTransfersItinerary(p.payload).id).toBe(p.fewest);
    const nd = { itineraries: p.payload.itineraries.slice(0, 3) };
    expect(fastestItinerary(nd).id).toBe(p.fastest_nodirect);
    expect(fewestTransfersItinerary(nd).id).toBe(p.fewest_nodirect);
  });
  it("areas", () => {
    for (const c of data.areas as Json[]) expect(matchAreas(c.in)).toEqual(c.out);
  });
});
