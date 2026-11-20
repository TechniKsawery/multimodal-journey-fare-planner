import { describe, expect, it } from "vitest";
import { buildResults, isValidItinerary } from "./adapt";
import { toDiscountProfile } from "./profile";
import { eicDomestic, iceDomestic, icDomestic, impossible, mixed } from "./fixtures/poznan-berlin";
import type { Profile } from "../types";

const none: Profile = { status: 'none', idCountry: 'pl', age: 30, bahncard: 'none' };
const student: Profile = { status: 'student', idCountry: 'pl', age: 21, bahncard: 'none' };

describe("toDiscountProfile", () => {
  it("applies the student relief only for a Polish ID and age <= 26", () => {
    expect(toDiscountProfile(student).pkp_ulga_kod).toBe("student_do_26_lat_doktorant_do_35_lat");
    expect(toDiscountProfile({ ...student, age: 30 }).pkp_ulga_kod).toBe("brak");
    expect(toDiscountProfile({ ...student, idCountry: "de" }).pkp_ulga_kod).toBe("brak");
  });
});

describe("buildResults", () => {
  it("prices a Polish IC with the official band table and the student relief", () => {
    const [r] = buildResults([icDomestic], student);
    const leg = r.legs[0];
    expect(leg.status).toBe("estimate"); // no verification date in the data -> never "official"
    expect(leg.reason).toBe("noVerifiedDate");
    expect(leg.sourceUrl).toMatch(/^https:\/\/www\.intercity\.pl\//);
    const [plain] = buildResults([icDomestic], none);
    expect(leg.price!).toBeCloseTo(plain.legs[0].price! * 0.49, 1);
  });

  it("never prices EIC/EIP: unconfirmed, no amount, no total", () => {
    const [r] = buildResults([eicDomestic], student);
    expect(r.legs[0].price).toBeUndefined();
    expect(r.legs[0].status).toBe("unconfirmed");
    expect(r.legs[0].reason).toBe("coreFallback");
    expect(r.legs[0].note).toMatch(/EIC/);
    expect(r.noPrice).toBe(true);
    expect(r.tag).not.toBe("cheapest");
  });

  it("prices a domestic DB leg as an estimate in EUR, BahnCard lowers it", () => {
    const [a] = buildResults([iceDomestic], none);
    const [b] = buildResults([iceDomestic], { ...none, bahncard: "50" });
    expect(a.legs[0].currency).toBe("EUR");
    expect(a.legs[0].status).toBe("estimate");
    expect(b.legs[0].price!).toBeCloseTo(a.legs[0].price! / 2, 1);
    expect(a.totalPln).toBeGreaterThan(a.legs[0].price!); // converted to PLN
  });

  it("mixed PL-DE trip: priced where certain, the rest is explicitly unconfirmed and out of the sum", () => {
    const [r] = buildResults([mixed], student);
    expect(r.legs.map((l) => l.status)).toEqual(["estimate", "unconfirmed", "unconfirmed"]);
    expect(r.legs[1].price).toBeUndefined();
    expect(r.legs[1].reason).toBe("coreFallback");
    expect(r.partial).toBe(true);
    expect(r.noPrice).toBe(false);
    expect(r.totalPln).toBe(r.legs[0].price);
    expect(r.status).toBe("unconfirmed");
    expect(r.transfers).toHaveLength(2);
    expect(r.transfers[0].minutes).toBe(20);
    expect(r.transfers[0].risk).toBe("ok"); // 20 min: below core's 30 min walk estimate, but not warned in the UI
    expect(r.pricedLegs).toBe(1);
    expect(r.totalLegs).toBe(3);
    expect(r.legs[0].depart).toBe("07:10"); // 06:10Z shown in Europe/Warsaw
  });

  it("re-prices from the same raw data when the profile changes", () => {
    const a = buildResults([icDomestic], none)[0].totalPln;
    const b = buildResults([icDomestic], student)[0].totalPln;
    expect(b).toBeLessThan(a);
  });

  it("keeps a too-short transfer visible (warned, untagged) and drops malformed entries", () => {
    const [imp] = buildResults([impossible], none);
    expect(imp.transfers[0].risk).toBe("tight");
    expect(imp.tag).toBeUndefined();
    expect(buildResults([null, {}, { legs: [], startTime: "x" }, { startTime: "x", legs: [{ mode: "RAIL" }] }], none)).toHaveLength(0);
    expect(isValidItinerary(mixed)).toBe(true);
  });

  it("tags the cheapest and the fastest only when justified", () => {
    const res = buildResults([icDomestic, eicDomestic], none);
    const tags = Object.fromEntries(res.map((r) => [r.legs[0].carrier, r.tag]));
    expect(tags["PKP Intercity IC 1310"]).toBe("cheapest");
    expect(res.some((r) => r.tag === "fastest")).toBe(true);
  });
});

describe("robustness against odd real-world data", () => {
  it("handles missing tz/agency, extra keys and a walk-only itinerary without throwing", () => {
    const odd = {
      startTime: "2026-11-23T06:10:00+01:00",
      endTime: "2026-11-23T09:40:00+01:00",
      duration: 1,
      transfers: 0,
      extra: { x: 1 },
      legs: [
        { mode: "WALK", from: { name: "START", lat: 51.2, lon: 22.5 }, to: { name: "Lublin", lat: 51.2, lon: 22.5, stopId: "a" }, startTime: "2026-11-23T06:10:00+01:00", endTime: "2026-11-23T06:15:00+01:00", duration: 1, distance: 300 },
        { mode: "LONG_DISTANCE", from: { name: "Lublin", lat: 51.23, lon: 22.57 }, to: { name: "Berlin Hbf", lat: 52.52, lon: 13.37 }, startTime: "2026-11-23T06:20:00+01:00", endTime: "2026-11-23T09:40:00+01:00", duration: 1, agencyName: null, routeShortName: null, tripId: "t" },
      ],
    };
    const walkOnly = { ...odd, legs: [odd.legs[0]] };
    const res = buildResults([odd, walkOnly, 5, undefined], student);
    expect(res).toHaveLength(1);
    expect(["estimate", "unconfirmed"]).toContain(res[0].legs[0].status);
  });
});
