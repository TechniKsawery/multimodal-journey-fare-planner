import { describe, expect, it } from "vitest";
import { buildResults, isValidItinerary } from "./adapt";
import { countryOf } from "./geo";
import { toDiscountProfile } from "./pricing";
import { eicDomestic, iceDomestic, icDomestic, impossible, mixed } from "./fixtures/poznan-berlin";
import type { Profile } from "../types";

const none: Profile = { status: 'none', idCountry: 'pl', age: 30, bahncard: 'none' };
const student: Profile = { status: 'student', idCountry: 'pl', age: 21, bahncard: 'none' };

describe("countryOf", () => {
  it.each([
    ["Warszawa", 52.23, 21.0, "PL"],
    ["Poznań", 52.4, 16.91, "PL"],
    ["Gdańsk", 54.35, 18.64, "PL"],
    ["Lublin", 51.25, 22.57, "PL"],
    ["Kraków", 50.06, 19.94, "PL"],
    ["Szczecin", 53.43, 14.55, "PL"],
    ["Berlin", 52.52, 13.4, "DE"],
    ["Köln", 50.94, 6.96, "DE"],
    ["Gelsenkirchen", 51.51, 7.1, "DE"],
    ["München", 48.14, 11.56, "DE"],
    ["Hamburg", 53.55, 10.0, "DE"],
  ] as const)("%s", (_n, lat, lon, c) => expect(countryOf(lat, lon)).toBe(c));
  it.each([
    ["Praha", 50.08, 14.44],
    ["Amsterdam", 52.37, 4.9],
    ["Wien", 48.21, 16.37],
    ["Ostrava", 49.83, 18.28],
    ["Kaliningrad", 54.71, 20.51],
    ["Słubice border", 52.35, 14.56],
  ] as const)("%s is unknown", (_n, lat, lon) => expect(countryOf(lat, lon)).toBeNull());
});

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
    expect(r.legs[0].reason).toBe("premiumTrain");
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
    expect(r.legs[1].reason).toBe("otherCarrier");
    expect(r.partial).toBe(true);
    expect(r.noPrice).toBe(false);
    expect(r.totalPln).toBe(r.legs[0].price);
    expect(r.status).toBe("unconfirmed");
    expect(r.transfers).toHaveLength(2);
    expect(r.transfers[0].minutes).toBe(20);
    expect(r.legs[0].depart).toBe("07:10"); // 06:10Z shown in Europe/Warsaw
  });

  it("re-prices from the same raw data when the profile changes", () => {
    const a = buildResults([icDomestic], none)[0].totalPln;
    const b = buildResults([icDomestic], student)[0].totalPln;
    expect(b).toBeLessThan(a);
  });

  it("drops physically impossible transfers and malformed entries", () => {
    expect(buildResults([impossible], none)).toHaveLength(0);
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
