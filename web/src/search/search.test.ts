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
    expect(leg.status).toBe("ceiling"); // verified band table (2026-11-21): the list price is the maximum before promotions
    expect(leg.reason).toBeUndefined();
    expect(leg.sourceUrl).toMatch(/^https:\/\/www\.intercity\.pl\//);
    const [plain] = buildResults([icDomestic], none);
    expect(leg.price!).toBeCloseTo(plain.legs[0].price! * 0.49, 1);
  });

  it("prices EIC/EIP with official relation base tariff and student discount instead of unconfirmed", () => {
    const [r] = buildResults([eicDomestic], student);
    expect(r.legs[0].price).toBeCloseTo(149 * 0.49, 1);
    expect(r.legs[0].status).toBe("ceiling");
    expect(r.legs[0].note).toMatch(/EIC/);
    expect(r.noPrice).toBe(false);
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
    expect(r.legs.map((l) => l.status)).toEqual(["ceiling", "unconfirmed", "unconfirmed"]);
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

describe("BahnCard 100", () => {
  it("makes a domestic DB leg free (core multiplier 0.0) and is passed to core as '100'", () => {
    expect(toDiscountProfile({ ...none, bahncard: "100" }).bahncard).toBe("100");
    const [r] = buildResults([iceDomestic], { ...none, bahncard: "100" });
    expect(r.legs[0].price).toBe(0);
  });
});

describe("fully priced filtering and recommendations", () => {
  it("distinguishes fully priced itineraries from partial ones", () => {
    const res = buildResults([icDomestic, mixed, eicDomestic], student);
    const fullyPriced = res.filter((it) => !it.partial && !it.noPrice);
    expect(fullyPriced.length).toBe(2);
    expect(fullyPriced.map((it) => it.legs[0].carrier)).toEqual(["PKP Intercity IC 1310", "PKP Intercity EIC 1604"]);

    const partialOrUnpriced = res.filter((it) => it.partial || it.noPrice);
    expect(partialOrUnpriced.length).toBe(1);
    expect(partialOrUnpriced[0].partial).toBe(true);
  });
});

describe("unconfirmed fare fixes: NEB RB26, PolRegio student discount, FlixBus", () => {
  it("prices NEB RB26 Kostrzyn <-> Berlin with official VBB Anschlusstarif", () => {
    const nebItinerary = {
      startTime: "2026-11-23T22:05:00Z",
      endTime: "2026-11-23T23:24:00Z",
      duration: 4740,
      transfers: 0,
      legs: [
        {
          mode: "REGIONAL_RAIL",
          from: { name: "Kostrzyn", lat: 52.5909, lon: 14.6538, tz: "Europe/Warsaw" },
          to: { name: "S+U Lichtenberg Bhf (Berlin)", lat: 52.5105, lon: 13.498, tz: "Europe/Berlin" },
          startTime: "2026-11-23T22:05:00Z",
          endTime: "2026-11-23T23:24:00Z",
          duration: 4740,
          agencyName: "NEB Niederbarnimer Eisenbahn",
          routeShortName: "RB26",
        },
      ],
    };

    const [regular] = buildResults([nebItinerary], none);
    expect(regular.legs[0].price).toBe(14.8);
    expect(regular.legs[0].currency).toBe("EUR");
    expect(regular.legs[0].status).toBe("official");
    expect(regular.legs[0].sourceUrl).toContain("neb.de");
    expect(regular.partial).toBe(false);

    const [withDticket] = buildResults([nebItinerary], { ...none, bahncard: "100" });
    expect(withDticket.legs[0].price).toBe(2.6);
    expect(withDticket.legs[0].currency).toBe("EUR");
    expect(withDticket.legs[0].status).toBe("official");
  });

  it("prices PolRegio with statutory student relief from official band table", () => {
    const polregioItinerary = {
      startTime: "2026-11-23T19:28:00Z",
      endTime: "2026-11-23T21:00:00Z",
      duration: 5520,
      transfers: 0,
      legs: [
        {
          mode: "REGIONAL_RAIL",
          from: { name: "Krzyż", lat: 52.9803, lon: 16.0125, tz: "Europe/Warsaw" },
          to: { name: "Kostrzyn", lat: 52.5909, lon: 14.6538, tz: "Europe/Warsaw" },
          startTime: "2026-11-23T19:28:00Z",
          endTime: "2026-11-23T21:00:00Z",
          duration: 5520,
          agencyName: "POLREGIO",
          routeShortName: "R",
        },
      ],
    };

    const [r] = buildResults([polregioItinerary], student);
    expect(r.legs[0].price).toBeGreaterThan(0);
    expect(r.legs[0].status).toBe("ceiling");
    expect(r.legs[0].currency).toBe("PLN");
    expect(r.partial).toBe(false);
  });

  it("prices FlixBus with dynamic pricing distance estimate and disclaimer", () => {
    const flixItinerary = {
      startTime: "2026-11-23T15:15:00Z",
      endTime: "2026-11-23T17:20:00Z",
      duration: 7500,
      transfers: 0,
      legs: [
        {
          mode: "COACH",
          from: { name: "Lublin, Bus Station Lublin", lat: 51.2465, lon: 22.5684, tz: "Europe/Warsaw" },
          to: { name: "Warsaw, Chopin Airport", lat: 52.1672, lon: 20.9679, tz: "Europe/Warsaw" },
          startTime: "2026-11-23T15:15:00Z",
          endTime: "2026-11-23T17:20:00Z",
          duration: 7500,
          agencyName: "FlixBus-eu",
          routeShortName: "FlixBus 1252",
        },
      ],
    };

    const [r] = buildResults([flixItinerary], none);
    expect(r.legs[0].price).toBeGreaterThan(0);
    expect(r.legs[0].status).toBe("estimate");
    expect(r.legs[0].reason).toBe("dynamicPricing");
    expect(r.legs[0].sourceUrl).toContain("flixbus.pl");
    expect(r.partial).toBe(false);
    expect(r.totalPln).toBe(r.legs[0].price);
  });
});
