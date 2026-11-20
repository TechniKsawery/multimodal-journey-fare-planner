// Golden tests for routing/pricing.py (leg pricing and geography) and fares/international_pkp.py.
import { describe, expect, it } from "vitest";
import golden from "../golden/pricing.json";
import { estimatePkpOffer, spiRange, spiRangeForSegment } from "../src/fares/internationalPkp";
import { Carrier, defaultProfile, makeSegment, type DiscountProfile } from "../src/fares/model";
import { ValueError } from "../src/pyCompat";
import { LegMode, makeLeg, type Leg, type PricedLeg } from "../src/routing/model";
import * as pr from "../src/routing/pricing";
import { canonical, capture, firstDiff, fnv1a64, productCases } from "./golden";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const data = golden as unknown as Json;
const DEPART = new Date("2026-10-20T08:00:00Z");

function makeTestLeg(c: Json): Leg {
  const p = c.pair as Json;
  const extra: Record<string, unknown> = {};
  if (p.olat !== null) Object.assign(extra, { origin_lat: p.olat, origin_lon: p.olon, destination_lat: p.dlat, destination_lon: p.dlon });
  if (p.ostop) extra.origin_stop_id = p.ostop;
  if (p.dstop) extra.destination_stop_id = p.dstop;
  if (c.motis) extra.motis_mode = c.motis;
  if (c.route) extra.route_short_name = c.route;
  if (c.along) {
    extra.distance_along_track_km = p.along;
    extra.distance_along_track_source = "geometria odcinka z MOTIS (legGeometry)";
  }
  return makeLeg({
    mode: c.mode as LegMode,
    origin_name: p.o,
    destination_name: p.d,
    depart: DEPART,
    arrive: new Date(DEPART.getTime() + (c.duration ?? 30) * 60000),
    carrier_name: c.carrier,
    distance_km: p.dist,
    extra,
  });
}

const r9 = (x: number | null) => (x === null ? null : Number(x.toFixed(9)));
function detect(leg: Leg) {
  const ends = pr.legEndpoints(leg);
  return {
    city: pr.cityCarrierForLeg(leg),
    city_de: pr.cityCarrierForLeg(leg, pr.DE_CITY_RAIL_CARRIERS),
    city_waw: pr.cityCarrierForLeg(leg, [Carrier.ZTM_WARSZAWA]),
    zvon_area: pr.isInZvonGorlitzArea(leg),
    zvon: pr.isZvonEuropastadtLeg(leg),
    bvg_zone: pr.bvgTariffZone(leg),
    nrw: pr.isLegInNrw(leg),
    o_country: pr.legEndpointCountry(leg, "origin"),
    d_country: pr.legEndpointCountry(leg, "destination"),
    frac: r9(pr.germanPortionFraction(leg)),
    cross: pr.isCrossBorderPlDe(leg),
    rail: pr.inferRailCarrier(leg.carrier_name),
    regional: pr.inferPlRegionalCarrier(leg),
    local: pr.inferPlLocalRailCarrier(leg),
    km_wkd: pr.isKmOrWkd(leg),
    kml: pr.isKolejeMalopolskie(leg),
    kmz: pr.isKolejeMazowieckie(leg),
    airport_line: pr.isWarsawAirportLine(leg),
    premium: pr.isPkpPremiumTrain(leg),
    kd: pr.isKdZgorzelecGorlitz(leg),
    graniczny: pr.isBiletGranicznyZasiekiForst(leg),
    suburban: pr.isSuburbanLeg(leg),
    train_line: pr.isTrainLikeLine(leg),
    ends: ends !== null,
  };
}

const pricedJson = (profile: DiscountProfile, leg: Leg) => {
  const res = capture(() => pr.priceLeg(leg, profile)) as Json;
  if (!("ok" in res)) return res;
  const pl = res.ok as PricedLeg;
  return { ok: { amount: pl.amount, currency: pl.currency, price_type: pl.price_type, notes: pl.notes, breakdown: pl.breakdown, carrier: pl.carrier } };
};

const PROFILES: Partial<DiscountProfile>[] = [
  {},
  { age: 8, child_with_guardian: true },
  { age: 20, pkp_ulga_kod: "student_do_26_lat_doktorant_do_35_lat", ztm_warszawa_ulgowy: true, mpk_krakow_ulgowy: true, ztm_lublin_ulgowy: true, bvg_berlin_ulgowy: true },
  { age: 70, bahncard: "50" },
  { age: 16, bahncard: "25", obywatelstwo: "UE", vrr_dziecko: true, hvv_dziecko: true },
];
const profile = (i: number): DiscountProfile => ({ ...defaultProfile(), ...PROFILES[i] });

const grid = (name: string) => (data.grids as Json[]).find((g) => g.name === name)!;
function checkGrid(name: string, fn: (c: Json) => unknown): void {
  const g = grid(name);
  const cases = productCases(g.axes);
  expect(cases.length).toBe(g.hashes.length);
  const bad: string[] = [];
  cases.forEach((c, i) => {
    if (fnv1a64(canonical(fn(c))).slice(0, 12) !== g.hashes[i]) bad.push(`${JSON.stringify({ ...c, pair: (c.pair as Json | undefined)?.o + "->" + (c.pair as Json | undefined)?.d })} -> ${canonical(fn(c))}`);
  });
  expect(bad.slice(0, 3)).toEqual([]);
}

describe("leg detection (geography, names, datasets)", () => {
  it("matches the oracle", () => {
    checkGrid("detect", (c) => detect(makeTestLeg(c)));
  });
});

describe("leg pricing", () => {
  it("default profile, all carrier names x modes x MOTIS modes x lines x stop pairs x track km", () =>
    checkGrid("price", (c) => pricedJson(profile(0), makeTestLeg({ ...c, duration: 25 }))));
  it("ride duration (time-ticket city tariffs)", () => checkGrid("durations", (c) => pricedJson(profile(0), makeTestLeg(c))));
  it("discount profiles", () => checkGrid("profiles", (c) => pricedJson(profile(c.profile as number), makeTestLeg({ ...c, motis: null, route: null, duration: 25, along: false }))));
  it("readable legs (full output)", () => {
    for (const r of data.readable as Json[]) {
      const leg = makeTestLeg({ carrier: r.carrier, mode: r.mode, motis: r.motis, route: r.route, pair: data.pairs[r.pair], duration: 25, along: false });
      expect(firstDiff(pricedJson(profile(r.profile), leg), r.expect), `${r.carrier} ${data.pairs[r.pair].o}`).toBeNull();
    }
  });
  it("walk legs are free", () => {
    const leg = makeTestLeg({ carrier: "pieszo", mode: "pieszo", motis: null, route: null, pair: data.pairs[0] });
    expect(firstDiff(pricedJson(profile(0), leg), data.walk)).toBeNull();
  });
  it("flights are not priced here", () => {
    const leg = makeLeg({ mode: LegMode.FLIGHT, origin_name: "a", destination_name: "b", depart: DEPART, arrive: DEPART });
    expect(() => pr.priceLeg(leg, defaultProfile())).toThrow(ValueError);
  });
  it("constants", () => {
    expect(pr.LOCAL_BUS_MAX_KM).toBe(data.constants.local_bus_max_km);
    expect(Object.fromEntries(pr.CITY_TARIFF_AREAS.map(([c, a]) => [c, [...a]]))).toEqual(data.constants.city_areas);
  });
});

describe("PKP Polska-Niemcy offer and SPI range", () => {
  it("matches the oracle", () => {
    for (const c of data.international_pkp as Json[]) {
      const seg = makeSegment({ carrier: Carrier.INTERNATIONAL_PL_DE, origin: c.o, destination: c.d, discounts: { age: c.age } });
      const est = estimatePkpOffer(seg);
      const got = est && { amount: est.amount, currency: est.currency, price_type: est.price_type, breakdown: est.breakdown, notes: est.notes };
      expect(firstDiff(got, c.offer), `${c.o} -> ${c.d} age ${c.age}`).toBeNull();
      expect(firstDiff(spiRangeForSegment(seg), c.spi_seg), `spi ${c.o} -> ${c.d} age ${c.age}`).toBeNull();
      expect(firstDiff(spiRange(c.o, c.d, "klasa_1"), c.spi_k1), `spi1 ${c.o} -> ${c.d}`).toBeNull();
    }
  });
  it("rejects another carrier", () => {
    expect(capture(() => estimatePkpOffer(makeSegment({ carrier: Carrier.DB, origin: "a", destination: "b" })))).toEqual(data.international_pkp_wrong_carrier);
  });
});
