// Port of routing/pricing.py: prices ONE leg — dispatch to the fares/ calculators by where the leg is
// (geography first, names only as a fallback) and who runs it. Flights are NOT ported: price_flight_leg
// needs the Travelpayouts API (not allowed by Transitous's non-commercial terms, see the plan, decision 8.4).
import { estimatePrice } from "../fares/calculator";
import * as dticket from "../fares/deutschlandticket";
import { estimatePkpOffer, spiRangeForSegment } from "../fares/internationalPkp";
import { Carrier, PriceType, defaultProfile, makeSegment, type DiscountProfile, type PriceEstimate, type Segment } from "../fares/model";
import { ValueError, formatFixed, matchesAnyWord, round2, truthy } from "../pyCompat";
import { haversineKm } from "./motis";
import { LegMode, legDurationMin, makePricedLeg, type Leg, type PricedLeg } from "./model";

/** A rough PLN/km used ONLY when no tariff module covers the carrier (or a calculator rejected the segment). */
export const GENERIC_FALLBACK_PLN_PER_KM = 0.35;

type Area = readonly [number, number, number]; // [lat, lon, radius km]

export const ZTM_LUBLIN_KEYWORDS = ["lublin", "zditm", "ztm lublin"] as const;
export const ZTM_WARSZAWA_KEYWORDS = ["warszawa", "ztm warszawa", "wtp"] as const;
export const MPK_KRAKOW_KEYWORDS = ["kraków", "krakow", "krakowie", "ztp kraków", "ztp krakow", "kmk"] as const;
export const ZTM_POZNAN_KEYWORDS = ["poznań", "poznan", "ztm poznań", "ztm poznan"] as const;
export const MPK_WROCLAW_KEYWORDS = ["wrocław", "wroclaw", "mpk wrocław", "mpk wroclaw"] as const;
export const BVG_BERLIN_KEYWORDS = ["berlin", "bvg"] as const;
export const HVV_KEYWORDS = ["hamburg", "hvv"] as const;
export const MVV_KEYWORDS = ["münchen", "muenchen", "munchen", "mvv"] as const;
export const VRS_KOLN_KEYWORDS = ["köln", "koeln", "koln", "kvb"] as const;

/** City tariff areas: (lat, lon) of the centre and the radius in km — a circle, not a zone map. Insertion order matters. */
export const CITY_TARIFF_AREAS: readonly (readonly [Carrier, Area])[] = [
  [Carrier.ZTM_LUBLIN, [51.2465, 22.5684, 12.0]],
  [Carrier.ZTM_WARSZAWA, [52.2297, 21.0122, 15.0]],
  [Carrier.MPK_KRAKOW, [50.0614, 19.9366, 13.0]],
  [Carrier.ZTM_POZNAN, [52.4064, 16.9252, 11.0]],
  [Carrier.MPK_WROCLAW, [51.1079, 17.0385, 11.0]],
  [Carrier.BVG_BERLIN, [52.52, 13.405, 20.0]],
  [Carrier.HVV, [53.5511, 9.9937, 12.0]],
  [Carrier.MVV, [48.1374, 11.5755, 11.0]],
  [Carrier.VRS_KOLN, [50.9375, 6.9603, 12.0]],
];
const AREA_OF = new Map<Carrier, Area>(CITY_TARIFF_AREAS);

const CITY_KEYWORDS: readonly (readonly [readonly string[], Carrier])[] = [
  [ZTM_LUBLIN_KEYWORDS, Carrier.ZTM_LUBLIN],
  [ZTM_WARSZAWA_KEYWORDS, Carrier.ZTM_WARSZAWA],
  [MPK_KRAKOW_KEYWORDS, Carrier.MPK_KRAKOW],
  [ZTM_POZNAN_KEYWORDS, Carrier.ZTM_POZNAN],
  [MPK_WROCLAW_KEYWORDS, Carrier.MPK_WROCLAW],
  [BVG_BERLIN_KEYWORDS, Carrier.BVG_BERLIN],
  [HVV_KEYWORDS, Carrier.HVV],
  [MVV_KEYWORDS, Carrier.MVV],
  [VRS_KOLN_KEYWORDS, Carrier.VRS_KOLN],
];

/** Tariffs whose Verbundtarif also covers S-Bahn/regional trains inside the city. */
export const DE_CITY_RAIL_CARRIERS: readonly Carrier[] = [Carrier.BVG_BERLIN, Carrier.HVV, Carrier.MVV, Carrier.VRS_KOLN];

export const ZVON_GORLITZ_AREA: Area = [51.152, 14.998, 9.0];
export const BER_AIRPORT_AREA: Area = [52.3644, 13.5108, 2.5];
export const BER_AIRPORT_KEYWORDS = ["flughafen ber", "ber airport", "airport ber", "flughafen berlin brandenburg"] as const;

const lower = (s: string): string => s.toLowerCase();
const extraGet = (leg: Leg, key: string): unknown => leg.extra[key] ?? null;

type Point = readonly [number, number];

/** Coordinates of both ends from leg.extra (set by the MOTIS parser), or null. */
export function legEndpoints(leg: Leg): [Point, Point] | null {
  const c = ["origin_lat", "origin_lon", "destination_lat", "destination_lon"].map((k) => extraGet(leg, k));
  if (c.some((v) => v === null)) return null;
  return [
    [c[0] as number, c[1] as number],
    [c[2] as number, c[3] as number],
  ];
}

const withinArea = (points: readonly Point[], area: Area): boolean =>
  points.every(([lat, lon]) => haversineKm(lat, lon, area[0], area[1]) <= area[2]);

/**
 * City tariff for a leg: with both end coordinates — geography ONLY (both ends in the same area);
 * without coordinates — carrier and stop names matched as whole words. null when undecidable.
 */
export function cityCarrierForLeg(leg: Leg, carriers: readonly Carrier[] | null = null): Carrier | null {
  const allowed: readonly Carrier[] = carriers && carriers.length > 0 ? carriers : CITY_TARIFF_AREAS.map(([c]) => c);
  const endpoints = legEndpoints(leg);
  if (endpoints !== null) {
    for (const carrier of allowed) {
      if (withinArea(endpoints, AREA_OF.get(carrier)!)) return carrier;
    }
    return null;
  }
  const text = lower(`${leg.carrier_name} ${leg.origin_name} ${leg.destination_name}`);
  for (const [keywords, carrier] of CITY_KEYWORDS) {
    if (allowed.includes(carrier) && matchesAnyWord(text, keywords)) return carrier;
  }
  return null;
}

export function isInZvonGorlitzArea(leg: Leg): boolean {
  const endpoints = legEndpoints(leg);
  return endpoints !== null && withinArea(endpoints, ZVON_GORLITZ_AREA);
}

export const isZvonEuropastadtLeg = (leg: Leg): boolean => lower(leg.carrier_name).includes("zvon") && isInZvonGorlitzArea(leg);

/** Zone "ABC" when an end of a BVG leg is at BER airport (zone C), otherwise null. */
export function bvgTariffZone(leg: Leg): string | null {
  const endpoints = legEndpoints(leg);
  const atBer =
    endpoints !== null
      ? endpoints.some(([lat, lon]) => haversineKm(lat, lon, BER_AIRPORT_AREA[0], BER_AIRPORT_AREA[1]) <= BER_AIRPORT_AREA[2])
      : matchesAnyWord(lower(`${leg.origin_name} ${leg.destination_name}`), BER_AIRPORT_KEYWORDS);
  return atBer ? "ABC" : null;
}

// Rectangles COMPLETELY inside NRW (with a margin from the borders): eezy.nrw applies only there.
const NRW_INNER_BOXES = [
  { lat_min: 50.95, lat_max: 51.8, lon_min: 6.4, lon_max: 8.2 },
  { lat_min: 51.8, lat_max: 52.05, lon_min: 7.2, lon_max: 8.9 },
  { lat_min: 51.5, lat_max: 51.8, lon_min: 8.2, lon_max: 8.8 },
  { lat_min: 50.65, lat_max: 50.95, lon_min: 6.6, lon_max: 7.2 },
  { lat_min: 50.74, lat_max: 50.83, lon_min: 6.09, lon_max: 6.6 },
] as const;

const inNrw = (lat: number, lon: number): boolean =>
  NRW_INNER_BOXES.some((b) => b.lat_min <= lat && lat <= b.lat_max && b.lon_min <= lon && lon <= b.lon_max);

/** Both ends inside NRW. Without coordinates false: NRW is never assumed. */
export function isLegInNrw(leg: Leg): boolean {
  const endpoints = legEndpoints(leg);
  return endpoints !== null && endpoints.every(([lat, lon]) => inNrw(lat, lon));
}

export const PL_MOTIS_DATASETS: ReadonlySet<string> = new Set(["pl", "ztml", "ztmw", "krka", "krkm", "krkt"]);
export const DE_MOTIS_DATASETS: ReadonlySet<string> = new Set(["defv", "derv", "denv", "dehvv", "demvv", "devrs"]);

const PL_BBOX = { lat_min: 49.0, lat_max: 54.9, lon_min: 14.0, lon_max: 24.2 };
const DE_BBOX = { lat_min: 47.2, lat_max: 55.1, lon_min: 5.8, lon_max: 15.05 };

/** Approximate course of the PL/DE border (Oder-Neisse) as a polyline (lat, lon), south to north. */
const PL_DE_BORDER_LINE: readonly Point[] = [
  [50.87, 14.82],
  [51.01, 14.94],
  [51.08, 14.96],
  [51.15, 14.995],
  [51.2, 15.01],
  [51.27, 15.04],
  [51.4, 14.96],
  [51.47, 14.94],
  [51.55, 14.725],
  [51.74, 14.655],
  [51.95, 14.72],
  [52.07, 14.76],
  [52.15, 14.69],
  [52.34, 14.557],
  [52.58, 14.635],
  [52.67, 14.45],
  [52.75, 14.32],
  [52.84, 14.14],
  [53.05, 14.32],
  [53.2, 14.41],
  [53.3, 14.4],
  [53.45, 14.34],
  [53.55, 14.27],
  [53.7, 14.25],
  [53.93, 14.226],
];

const BORDER_MARGIN_DEG = 0.01;

function borderLonAt(lat: number): number | null {
  const line = PL_DE_BORDER_LINE;
  if (!(line[0][0] <= lat && lat <= line[line.length - 1][0])) return null;
  for (let i = 0; i + 1 < line.length; i++) {
    const [lat1, lon1] = line[i];
    const [lat2, lon2] = line[i + 1];
    if (lat1 <= lat && lat <= lat2) {
      const t = lat2 === lat1 ? 0.0 : (lat - lat1) / (lat2 - lat1);
      return lon1 + t * (lon2 - lon1);
    }
  }
  return null;
}

const inBox = (b: typeof PL_BBOX, lat: number, lon: number): boolean => b.lat_min <= lat && lat <= b.lat_max && b.lon_min <= lon && lon <= b.lon_max;

/** Country of a stop by coordinates: PL/DE boxes, and in their overlap the side of the border polyline; null if undecidable. */
export function countryFromLatLon(lat: number | null, lon: number | null): string | null {
  if (lat === null || lon === null) return null;
  const inPl = inBox(PL_BBOX, lat, lon);
  const inDe = inBox(DE_BBOX, lat, lon);
  if (inPl && !inDe) return "PL";
  if (inDe && !inPl) return "DE";
  if (!(inPl && inDe)) return null;
  const borderLon = borderLonAt(lat);
  if (borderLon === null) return null;
  if (lon < borderLon - BORDER_MARGIN_DEG) return "DE";
  if (lon > borderLon + BORDER_MARGIN_DEG) return "PL";
  return null;
}

function motisDataset(stopId: unknown): string | null {
  if (typeof stopId !== "string" || !stopId || !stopId.includes("_")) return null;
  return stopId.split("_", 1)[0];
}

function countryFromDataset(stopId: unknown): string | null {
  const dataset = motisDataset(stopId);
  if (dataset === null) return null;
  if (PL_MOTIS_DATASETS.has(dataset)) return "PL";
  if (DE_MOTIS_DATASETS.has(dataset)) return "DE";
  return null;
}

/** Country of one end ('origin'/'destination'): by coordinates first, by the dataset prefix only when they are missing. */
export function legEndpointCountry(leg: Leg, prefix: "origin" | "destination"): string | null {
  const lat = extraGet(leg, `${prefix}_lat`);
  const lon = extraGet(leg, `${prefix}_lon`);
  if (lat !== null && lon !== null) return countryFromLatLon(lat as number, lon as number);
  return countryFromDataset(extraGet(leg, `${prefix}_stop_id`));
}

export const BORDER_CROSSINGS_PL_DE: readonly { lat: number; lon: number }[] = [
  { lat: 52.3454, lon: 14.5583 }, // Frankfurt (Oder)/Słubice
  { lat: 53.33, lon: 14.4 }, // Tantow/Szczecin-Gumieńce
  { lat: 51.15, lon: 14.995 }, // Görlitz/Zgorzelec
  { lat: 51.74, lon: 14.655 }, // Forst/Zasieki
  { lat: 51.95, lon: 14.72 }, // Guben/Gubin
  { lat: 52.58, lon: 14.635 }, // Küstrin-Kietz/Kostrzyn
];

/** Estimated share (0-1) of the German part of an international leg (via the nearest crossing); null without coordinates. */
export function germanPortionFraction(leg: Leg): number | null {
  const endpoints = legEndpoints(leg);
  if (endpoints === null) return null;
  const [[oLat, oLon], [dLat, dLon]] = endpoints;
  let best: [number, number] | null = null;
  for (const c of BORDER_CROSSINGS_PL_DE) {
    const via: [number, number] = [haversineKm(oLat, oLon, c.lat, c.lon), haversineKm(c.lat, c.lon, dLat, dLon)];
    if (best === null || via[0] + via[1] < best[0] + best[1]) best = via; // first minimum wins, like Python min(key=sum)
  }
  const [distOriginBorder, distBorderDest] = best!;
  const total = distOriginBorder + distBorderDest;
  if (total <= 0) return null;
  if (legEndpointCountry(leg, "origin") === "DE") return distOriginBorder / total;
  return distBorderDest / total;
}

/** One continuous PL<->DE leg: detected geographically, the dataset prefix is only a fallback. False when undecidable. */
export function isCrossBorderPlDe(leg: Leg): boolean {
  const o = legEndpointCountry(leg, "origin");
  const d = legEndpointCountry(leg, "destination");
  if (o === null || d === null) return false;
  return o !== d;
}

export const LONG_DISTANCE_RAIL_KEYWORDS = ["flix"] as const;

/** Long-distance carrier by agency name only: PKP Intercity or DB Fernverkehr; every other name -> null (decided geographically). */
export function inferRailCarrier(agencyName: string | null | undefined): Carrier | null {
  const name = lower(agencyName ?? "");
  if (name.includes("pkp intercity")) return Carrier.PKP_INTERCITY;
  if (name.includes("db fernverkehr") || name.includes("deutsche bahn") || name.trim() === "db") return Carrier.DB;
  return null;
}

export const PL_REGIONAL_RAIL_KEYWORDS = ["polregio", "koleje dolnośląskie", "koleje dolnoslaskie", "koleje śląskie", "koleje slaskie"] as const;

export function inferPlRegionalCarrier(leg: Leg): Carrier | null {
  if (!matchesAnyWord(lower(leg.carrier_name), PL_REGIONAL_RAIL_KEYWORDS)) return null;
  if (legEndpointCountry(leg, "origin") === "PL" && legEndpointCountry(leg, "destination") === "PL") return Carrier.POLREGIO_PODSTAWOWA;
  return null;
}

export const SKM_KEYWORDS = ["skm", "szybka kolej miejska"] as const;
export const SKM_TROJMIASTO_NAME_KEYWORDS = ["trójmieście", "trojmiescie", "trójmiasto", "trojmiasto"] as const;
export const LKA_KEYWORDS = ["łka", "lka", "łódzka kolej aglomeracyjna", "lodzka kolej aglomeracyjna"] as const;
export const KM_WKD_KEYWORDS = ["koleje mazowieckie", "km", "wkd", "warszawska kolej dojazdowa"] as const;
export const KMZ_KEYWORDS = ["koleje mazowieckie", "km"] as const;
export const KML_KEYWORDS = ["koleje małopolskie", "koleje malopolskie", "kmł", "kml"] as const;
export const SKM_TROJMIASTO_AREA: Area = [54.44, 18.56, 20.0];
export const LKA_LODZ_AREA: Area = [51.7592, 19.456, 9.0];
export const KML_AIRPORT_KEYWORDS = ["lotnisko", "balice"] as const;
export const AIRPORT_LINE_KEYWORDS = [["płudy", "pludy"], ["lotnisko chopina"]] as const;
export const TARIFF_ZTM_STATUS = "wg Gemini, niezweryfikowane niezależnie";

/** Both ends in the circle, or null without coordinates. */
function legInArea(leg: Leg, area: Area): boolean | null {
  const endpoints = legEndpoints(leg);
  return endpoints === null ? null : withinArea(endpoints, area);
}

const squash = (s: string): string => lower(s).split(/\s+/u).filter(Boolean).join(" "); // Python " ".join(s.lower().split())
export const isKmOrWkd = (leg: Leg): boolean => matchesAnyWord(lower(leg.carrier_name), KM_WKD_KEYWORDS);
const isTrain = (leg: Leg): boolean => leg.mode === LegMode.RAIL || extraGet(leg, "motis_mode") === "SUBURBAN";

export function isKolejeMalopolskie(leg: Leg): boolean {
  return matchesAnyWord(squash(leg.carrier_name), KML_KEYWORDS) && isTrain(leg);
}

export function isKolejeMazowieckie(leg: Leg): boolean {
  const name = squash(leg.carrier_name);
  if (!matchesAnyWord(name, KMZ_KEYWORDS) || matchesAnyWord(name, ["wkd"])) return false;
  return isTrain(leg);
}

const touchesKrakowAirport = (leg: Leg): boolean =>
  [lower(leg.origin_name), lower(leg.destination_name)].some((stop) => KML_AIRPORT_KEYWORDS.some((k) => stop.includes(k)));

/** Warszawa Płudy <-> Warszawa Lotnisko Chopina (by station names, either direction). */
export function isWarsawAirportLine(leg: Leg): boolean {
  const names: [string, string] = [lower(leg.origin_name), lower(leg.destination_name)];
  const [pludy, lotnisko] = AIRPORT_LINE_KEYWORDS;
  return [names, [names[1], names[0]] as [string, string]].some(
    ([a, b]) => pludy.some((k) => a.includes(k)) && lotnisko.some((k) => b.includes(k)),
  );
}

/** Local rail tariff for a leg (MOTIS RAIL or SUBURBAN), otherwise null. See the oracle's docstring for the rules. */
export function inferPlLocalRailCarrier(leg: Leg): Carrier | null {
  const name = lower(leg.carrier_name);
  if (isKolejeMalopolskie(leg)) return touchesKrakowAirport(leg) ? null : Carrier.KOLEJE_MALOPOLSKIE;
  if (isKolejeMazowieckie(leg) && !(isWarsawAirportLine(leg) && cityCarrierForLeg(leg, [Carrier.ZTM_WARSZAWA]) === Carrier.ZTM_WARSZAWA)) {
    return Carrier.KOLEJE_MAZOWIECKIE;
  }
  if (matchesAnyWord(name, SKM_KEYWORDS)) {
    const inTrojmiasto = legInArea(leg, SKM_TROJMIASTO_AREA);
    if (inTrojmiasto || (inTrojmiasto === null && matchesAnyWord(name, SKM_TROJMIASTO_NAME_KEYWORDS))) return Carrier.SKM_TROJMIASTO;
    if (cityCarrierForLeg(leg, [Carrier.ZTM_WARSZAWA]) === Carrier.ZTM_WARSZAWA) return Carrier.ZTM_WARSZAWA;
    return null;
  }
  if (matchesAnyWord(name, LKA_KEYWORDS)) {
    let inLodz = legInArea(leg, LKA_LODZ_AREA);
    if (inLodz === null) {
      inLodz = [leg.origin_name, leg.destination_name].every((stop) => matchesAnyWord(lower(stop), ["łódź", "lodz"]));
    }
    return inLodz ? Carrier.LKA_LODZ : null;
  }
  if (isKmOrWkd(leg) && isWarsawAirportLine(leg) && cityCarrierForLeg(leg, [Carrier.ZTM_WARSZAWA]) === Carrier.ZTM_WARSZAWA) {
    return Carrier.ZTM_WARSZAWA;
  }
  return null;
}

/** [km, along_track]: track km from leg.extra when available, otherwise the straight line leg.distance_km. */
function tariffDistance(leg: Leg): [number | null, boolean] {
  const along = leg.extra["distance_along_track_km"];
  if (typeof along === "number" && along > 0) return [along, true];
  return [leg.distance_km, false];
}

const dateOf = (leg: Leg): string => leg.depart.toISOString().slice(0, 10); // MOTIS times are UTC, like the oracle's date()

/** Rough PLN/km estimate: always price_type "szacunek" and breakdown.price_verified = false. */
export function fallbackPricedLeg(leg: Leg, reason: string): PricedLeg {
  const distanceKm = leg.distance_km || 0.0;
  const amount = round2(GENERIC_FALLBACK_PLN_PER_KM * distanceKm);
  return makePricedLeg({
    leg,
    amount,
    currency: "PLN",
    price_type: "szacunek",
    notes: `${reason} Zgrubny szacunek: ${GENERIC_FALLBACK_PLN_PER_KM} PLN/km x ${formatFixed(distanceKm, 0)} km — cena niepotwierdzona.`,
    breakdown: { price_verified: false, powod_szacunku: reason },
  });
}

const fromEstimate = (leg: Leg, result: PriceEstimate, carrier: Carrier | null, extra: Partial<PricedLeg> = {}): PricedLeg =>
  makePricedLeg({
    leg,
    amount: result.amount,
    currency: result.currency,
    price_type: result.price_type,
    notes: result.notes,
    breakdown: { ...result.breakdown },
    carrier,
    ...extra,
  });

const calculatorError = (leg: Leg, carrier: string, exc: ValueError): PricedLeg =>
  fallbackPricedLeg(leg, `Kalkulator ${carrier} zwrócił błąd (${exc.message}).`);

export function pricePlLocalRailLeg(leg: Leg, carrier: Carrier, discounts: DiscountProfile): PricedLeg {
  let result: PriceEstimate;
  let alongTrack: boolean;
  try {
    let km: number | null;
    [km, alongTrack] = tariffDistance(leg);
    const segment = makeSegment({
      carrier,
      origin: leg.origin_name,
      destination: leg.destination_name,
      distance_km: km,
      ride_duration_min: legDurationMin(leg),
      discounts,
      travel_date: dateOf(leg),
      distance_along_track: alongTrack,
      distance_source: alongTrack ? ((leg.extra["distance_along_track_source"] as string | undefined) ?? null) : null,
    });
    result = estimatePrice(segment);
  } catch (e) {
    if (e instanceof ValueError) return calculatorError(leg, carrier, e);
    throw e;
  }

  const breakdown: Record<string, unknown> = { ...result.breakdown };
  let notes = result.notes;
  let priceType: string = result.price_type;
  if (carrier === Carrier.SKM_TROJMIASTO && alongTrack) {
    const source = leg.extra["distance_along_track_source"];
    if (truthy(source)) breakdown["zrodlo_km"] = source;
  }
  if (carrier === Carrier.ZTM_WARSZAWA) {
    const airport = isKmOrWkd(leg);
    breakdown["kolej"] = airport ? "KM linia lotniskowa Płudy - Lotnisko Chopina" : "SKM Warszawa";
    breakdown["status_weryfikacji_honorowania"] = TARIFF_ZTM_STATUS;
    // The ZTM amounts come from the price list, but that ZTM time tickets are honoured on SKM/KM is only from
    // the Gemini report: price_verified = false until a second independent source.
    breakdown["price_verified"] = false;
    breakdown["powod_szacunku"] = "honorowanie biletów ZTM w kolei tylko z raportu Gemini";
    priceType = PriceType.ESTIMATE;
    notes = `${airport ? "Linia lotniskowa KM (Płudy - Lotnisko Chopina)" : "SKM Warszawa"}: honorowane bilety czasowe ZTM (${TARIFF_ZTM_STATUS}). ${notes}`;
  }
  return makePricedLeg({ leg, amount: result.amount, currency: result.currency, price_type: priceType, notes, breakdown, carrier });
}

const kmWkdWithoutZtmTickets = (leg: Leg): PricedLeg =>
  fallbackPricedLeg(
    leg,
    `'${leg.carrier_name}': bilety czasowe ZTM nie są honorowane w pociągach KM i WKD (${TARIFF_ZTM_STATUS}), a taryfa KM/WKD nie jest wdrożona.`,
  );

export const PKP_PREMIUM_CATEGORIES = ["EIC", "EIP"] as const;

/** EIC/EIP (Express InterCity / Premium, Pendolino) by routeShortName or carrier name. */
export function isPkpPremiumTrain(leg: Leg): boolean {
  const route = truthy(leg.extra["route_short_name"]) ? String(leg.extra["route_short_name"]) : "";
  const text = `${route} ${leg.carrier_name}`;
  return matchesAnyWord(text.toUpperCase(), PKP_PREMIUM_CATEGORIES) || matchesAnyWord(lower(text), ["express intercity", "pendolino"]);
}

/** For a PL-DE ticket adds PKP's OWN offer on the same relation; the cheaper of the two is the main result. */
function withPkpAlternative(segment: Segment, dbResult: PriceEstimate): PriceEstimate {
  const pkpResult = estimatePkpOffer(segment);
  if (pkpResult === null) return dbResult;
  let main: PriceEstimate, alt: PriceEstimate, altLabel: string;
  if (pkpResult.amount <= dbResult.amount) [main, alt, altLabel] = [pkpResult, dbResult, "db"];
  else [main, alt, altLabel] = [dbResult, pkpResult, "pkp_oferta_polska_niemcy"];

  main.breakdown["alternatywna_oferta"] = { zrodlo: altLabel, cena: alt.amount, waluta: alt.currency };
  const altName = altLabel === "db" ? "DB Super Sparpreis Europa" : "PKP Oferta Polska-Niemcy";
  const tail = main === dbResult ? pkpResult.notes : dbResult.notes;
  main.notes =
    `${main.notes} Tańsza z dwóch dostępnych ofert na tę relację (PKP Intercity vs DB) — ` +
    `alternatywa: ${formatFixed(alt.amount, 2)} ${alt.currency} (${altName}). ${tail}`;
  return main;
}

/** Adds the SPI "from X to Y" range (breakdown.zakres_cen); amount stays the lower bound. */
function withSpiRange(segment: Segment, result: PriceEstimate): PriceEstimate {
  const spi = spiRangeForSegment(segment);
  if (spi === null) return result;
  const pkp = estimatePkpOffer(segment);
  const regular = pkp === null ? null : (pkp.breakdown["cena_regularna"] as number);
  const gorna = regular === null ? spi.do : Math.min(spi.do, regular);
  const od = Math.min(spi.od, result.amount);
  const doo = Math.max(gorna, od);
  let odZrodlo: string;
  if (spi.od <= result.amount) odZrodlo = "SPI poziom I";
  else if (result.breakdown["oferta"] === "pkp_oferta_polska_niemcy") odZrodlo = "PKP cennik regularny";
  else odZrodlo = "DB (cena od, bez górnej granicy w źródle)";
  const doZrodlo = regular === null || spi.do <= regular ? "SPI poziom V" : "PKP cennik regularny";
  result.breakdown["zakres_cen"] = {
    od,
    do: doo,
    waluta: spi.waluta,
    od_zrodlo: odZrodlo,
    do_zrodlo: doZrodlo,
    spi_od: spi.od,
    spi_do: spi.do,
    pkp_cena_regularna: regular,
    klasa: 2,
    pociagi_spi: spi.pociagi,
    zrodlo: spi.zrodlo,
    zrodlo_url: spi.zrodlo_url,
    data_cennika: spi.data_cennika,
  };
  result.notes =
    `${result.notes} Szacunek: od ${formatFixed(od, 2)} (${odZrodlo}) do ${formatFixed(doo, 2)} (${doZrodlo}) ${spi.waluta}. ` +
    `Przedział PKP Super Promo International: ${formatFixed(spi.od, 2)}-${formatFixed(spi.do, 2)} ${spi.waluta} ` +
    `(poziomy cenowe I-V, 2. klasa, dorosły; cennik od ${spi.data_cennika}). ` +
    "Który poziom obowiązuje danego dnia, cennik nie podaje.";
  return result;
}

export const KD_KEYWORDS = ["koleje dolnośląskie", "koleje dolnoslaskie"] as const;
export const GORLITZ_KEYWORDS = ["görlitz", "goerlitz", "gorlitz"] as const;
export const BILET_GRANICZNY_OPERATORZY = [...KD_KEYWORDS, "db regio"] as const;

function stopsBetween(leg: Leg, wordA: string, wordsB: readonly string[]): boolean {
  const stops: [string, string] = [lower(leg.origin_name), lower(leg.destination_name)];
  return [stops, [stops[1], stops[0]] as [string, string]].some(([a, b]) => matchesAnyWord(a, [wordA]) && matchesAnyWord(b, wordsB));
}

const isRailNotBus = (leg: Leg): boolean => leg.mode === LegMode.RAIL && extraGet(leg, "motis_mode") !== "BUS";

/** A KD TRAIN exactly between Zgorzelec and Görlitz (either direction). */
export function isKdZgorzelecGorlitz(leg: Leg): boolean {
  if (!isRailNotBus(leg)) return false;
  if (!matchesAnyWord(squash(leg.carrier_name), KD_KEYWORDS)) return false;
  return stopsBetween(leg, "zgorzelec", GORLITZ_KEYWORDS);
}

export function priceKdZgorzelecGorlitzLeg(leg: Leg): PricedLeg {
  const result = estimatePrice(
    makeSegment({ carrier: Carrier.KD_ZGORZELEC_GORLITZ, origin: leg.origin_name, destination: leg.destination_name, travel_date: dateOf(leg) }),
  );
  return fromEstimate(leg, result, Carrier.KD_ZGORZELEC_GORLITZ);
}

/** A KD or DB Regio TRAIN exactly between Zasieki and Forst (either direction). */
export function isBiletGranicznyZasiekiForst(leg: Leg): boolean {
  if (!isRailNotBus(leg)) return false;
  if (!matchesAnyWord(squash(leg.carrier_name), BILET_GRANICZNY_OPERATORZY)) return false;
  return stopsBetween(leg, "zasieki", ["forst"]);
}

export function priceBiletGranicznyZasiekiForstLeg(leg: Leg, discounts: DiscountProfile): PricedLeg {
  const result = estimatePrice(
    makeSegment({
      carrier: Carrier.BILET_GRANICZNY_ZASIEKI_FORST,
      origin: leg.origin_name,
      destination: leg.destination_name,
      discounts,
      travel_date: dateOf(leg),
    }),
  );
  return fromEstimate(leg, result, Carrier.BILET_GRANICZNY_ZASIEKI_FORST);
}

/**
 * A local/regional leg in Germany for a Deutschlandticket (or BahnCard 100, which includes one) holder: 0 EUR extra, with source and date.
 * null = not applicable. The scope is ONLY what the quotes in data/fares/deutschlandticket.json say: both ends in Germany, a regional
 * MOTIS mode (no HIGHSPEED_RAIL / LONG_DISTANCE / NIGHT_RAIL / COACH), not DB Fernverkehr / FlixTrain / FlixBus, not an ICE/IC/EC line.
 * A bare "RAIL" mode is not accepted either: we cannot tell whether it is Nahverkehr.
 */
export function deutschlandticketLeg(leg: Leg, discounts: DiscountProfile): PricedLeg | null {
  const basis = dticket.holderBasis(discounts);
  if (basis === null || leg.mode === LegMode.WALK) return null;
  const motisMode = extraGet(leg, "motis_mode");
  if (typeof motisMode !== "string" || !(dticket.SCOPE.tryby_motis_regionalne as readonly string[]).includes(motisMode)) return null;
  if (leg.mode === LegMode.RAIL && motisMode !== "REGIONAL_RAIL" && motisMode !== "REGIONAL_FAST_RAIL") return null;
  if (inferRailCarrier(leg.carrier_name) !== null || lower(leg.carrier_name).includes("flix")) return null;
  const route = leg.extra["route_short_name"];
  if (!dticket.lineAllowed(truthy(route) ? String(route) : "", basis)) return null;
  if (legEndpointCountry(leg, "origin") !== "DE" || legEndpointCountry(leg, "destination") !== "DE") return null;
  const info = dticket.sourceInfo(basis);
  return makePricedLeg({
    leg,
    amount: 0.0,
    currency: "EUR",
    price_type: "oficjalna_taryfa",
    notes:
      "Pokryte posiadanym " +
      (basis === dticket.BASIS_BAHNCARD_100 ? "BahnCard 100 (ma wliczone Deutschlandticket)" : "Deutschlandticket") +
      ` — 0 EUR dopłaty (zasady: ${info["zrodlo_url"]}, sprawdzono ${info["data_weryfikacji"]}). Sam bilet/abonament kosztuje osobno.`,
    breakdown: { price_verified: true, deutschlandticket: true, podstawa: basis, ...info },
  });
}

export function priceRailLeg(leg: Leg, discounts: DiscountProfile): PricedLeg {
  if (leg.mode !== LegMode.RAIL) throw new ValueError(`price_rail_leg wymaga LegMode.RAIL, dostał ${leg.mode}`);

  if (isKdZgorzelecGorlitz(leg)) return priceKdZgorzelecGorlitzLeg(leg);
  if (isBiletGranicznyZasiekiForst(leg)) return priceBiletGranicznyZasiekiForstLeg(leg, discounts);
  const covered = deutschlandticketLeg(leg, discounts);
  if (covered !== null) return covered;

  const nameCarrier = inferRailCarrier(leg.carrier_name);
  let carrier: Carrier | null;
  if (isCrossBorderPlDe(leg)) {
    // One continuous PL<->DE leg has its own fixed price categories and (partial) BahnCard rules; a regional
    // carrier on a cross-border run has no confirmed tariff here, so we do not substitute somebody else's.
    if (nameCarrier === null && leg.carrier_name.trim()) {
      return fallbackPricedLeg(
        leg,
        `Odcinek transgraniczny PL/DE przewoźnika '${leg.carrier_name}' — moduły taryf międzynarodowych obejmują tylko oferty PKP Intercity/DB, brak potwierdzonej taryfy dla tego przewoźnika.`,
      );
    }
    carrier = Carrier.INTERNATIONAL_PL_DE;
  } else {
    carrier = nameCarrier;
    if (carrier === null) carrier = inferPlRegionalCarrier(leg);
    if (carrier === null) {
      const local = inferPlLocalRailCarrier(leg);
      if (local !== null) return pricePlLocalRailLeg(leg, local, discounts);
    }
    if (carrier === null) {
      // Regional tariff depends on the place, not the carrier name: city tariffs (Verbund covers S-Bahn/RE inside
      // the city), eezy.nrw (VRR) only for a leg entirely in NRW.
      carrier = cityCarrierForLeg(leg, DE_CITY_RAIL_CARRIERS);
      if (carrier === null && isLegInNrw(leg) && !LONG_DISTANCE_RAIL_KEYWORDS.some((k) => lower(leg.carrier_name).includes(k))) {
        carrier = Carrier.VRR;
      }
    }
  }
  if (carrier === null) {
    return fallbackPricedLeg(
      leg,
      `Brak modułu taryf dla przewoźnika '${leg.carrier_name}' na tym odcinku (taryfa eezy.nrw/VRR obowiązuje tylko w NRW, taryfy miejskie tylko w obrębie miasta).`,
    );
  }

  let distanceKm: number | null = leg.distance_km;
  let alongTrack = false;
  let distanceSource: string | null = null;
  if (carrier === Carrier.POLREGIO_PODSTAWOWA) {
    // The POLREGIO/KD/KŚ band is counted in track km when MOTIS gave a geometry or intermediate stops.
    const trackKm = extraGet(leg, "distance_along_track_km");
    if (trackKm !== null) {
      distanceKm = trackKm as number;
      alongTrack = true;
      distanceSource = (extraGet(leg, "distance_along_track_source") as string | null) ?? null;
    }
  }

  let result: PriceEstimate;
  try {
    const segment = makeSegment({
      carrier,
      origin: leg.origin_name,
      destination: leg.destination_name,
      distance_km: distanceKm,
      distance_along_track: alongTrack,
      distance_source: distanceSource,
      ride_duration_min: legDurationMin(leg),
      discounts,
      travel_date: dateOf(leg),
      german_portion_fraction: carrier === Carrier.INTERNATIONAL_PL_DE ? germanPortionFraction(leg) : null,
      tariff_zone: carrier === Carrier.BVG_BERLIN ? bvgTariffZone(leg) : null,
    });
    result = estimatePrice(segment);
    if (carrier === Carrier.INTERNATIONAL_PL_DE) {
      result = withPkpAlternative(segment, result);
      result = withSpiRange(segment, result);
    }
  } catch (e) {
    if (e instanceof ValueError) return calculatorError(leg, carrier, e);
    throw e;
  }

  let priceType: string = result.price_type;
  let notes = result.notes;
  let breakdown: Record<string, unknown> = result.breakdown;
  if (carrier === Carrier.PKP_INTERCITY && isPkpPremiumTrain(leg)) {
    // The TLK/IC bands are not the source of an EIC/EIP price (per-relation prices we do not have).
    priceType = PriceType.ESTIMATE;
    breakdown = Object.fromEntries(Object.entries(breakdown).filter(([k]) => !["zrodlo_url", "zrodlo_ulgi_url", "data_weryfikacji"].includes(k)));
    breakdown = { ...breakdown, price_verified: false, kategoria_pociagu: "EIC/EIP" };
    notes =
      "Pociąg EIC/EIP: cena NIEPOTWIERDZONA — szacunek wg cennika TLK/IC (pasma odległości), " +
      "a EIC/EIP ma w cenniku PKP Intercity ceny ustalane per relacja, których nie mamy. " +
      notes;
  }
  if (carrier === Carrier.DB && discounts.bahncard === "100" && result.amount === 0.0) {
    // BahnCard 100 "gilt für beliebig viele Fahrten in allen Zügen der Deutschen Bahn (ICE, IC/EC, ...)": the 0 is confirmed by the
    // source here, not an estimate from the Flexpreis table.
    const bc = dticket.SCOPE.bahncard_100;
    breakdown = { ...breakdown, price_verified: true, zrodlo_url: bc.zrodlo_url, data_weryfikacji: bc.data_weryfikacji, cytat: bc.cytat_zakres };
    priceType = PriceType.OFFICIAL;
  }
  return makePricedLeg({ leg, amount: result.amount, currency: result.currency, price_type: priceType, notes, breakdown, carrier });
}

/** PLACEHOLDER (not a price list value): a stand-in for a non-rail MOTIS leg of an operator with no tariff module. */
export const LOCAL_BUS_FLAT_PLN = 4.0;
/** The largest city-tariff circle radius: beyond it a flat local fare makes no sense (derived from CITY_TARIFF_AREAS). */
export const LOCAL_BUS_MAX_KM = Math.max(...CITY_TARIFF_AREAS.map(([, a]) => a[2]));
export const LONG_LOCAL_LEG_REASON = "odcinek za długi na ryczałt lokalny";
// (?i) like re.IGNORECASE; used only as an auxiliary description signal.
export const TRAIN_LINE_PATTERN = /^(?:IRE|IR|RE|RB|RS|SKM|PKM|SKA|S)(?:\s*-?\d+[A-Za-z]?)?$/i;
export const LONG_DISTANCE_COACH_KEYWORDS = ["flix", "regiojet", "blablabus"] as const;

/** FlixBus: only the PLN/km fallback (the live API is not called from the client). */
export function priceFlixbusLeg(leg: Leg): PricedLeg {
  let result: PriceEstimate;
  try {
    result = estimatePrice(
      makeSegment({
        carrier: Carrier.FLIXBUS,
        origin: leg.origin_name,
        destination: leg.destination_name,
        distance_km: leg.distance_km,
        travel_date: dateOf(leg),
      }),
    );
  } catch (e) {
    if (e instanceof ValueError) return fallbackPricedLeg(leg, `Kalkulator FlixBus zwrócił błąd (${e.message}).`);
    throw e;
  }
  return fromEstimate(leg, result, null, { breakdown: result.breakdown });
}

export const SUBURBAN_MOTIS_MODE = "SUBURBAN";
export const isSuburbanLeg = (leg: Leg): boolean => extraGet(leg, "motis_mode") === SUBURBAN_MOTIS_MODE;

/** Suburban rail with no known tariff: NOT the bus flat fare, an explicitly unconfirmed PLN/km estimate. */
export function priceSuburbanLeg(leg: Leg): PricedLeg {
  const priced = fallbackPricedLeg(
    leg,
    `Kolej podmiejska (MOTIS: ${SUBURBAN_MOTIS_MODE}) '${leg.carrier_name}' poza obszarami z potwierdzoną taryfą (taryfy miejskie z CITY_TARIFF_AREAS, eezy.nrw w NRW) — brak zweryfikowanej stawki w data/fares/*; to nie autobus, więc bez ryczałtu autobusowego.`,
  );
  priced.breakdown["tryb_motis"] = SUBURBAN_MOTIS_MODE;
  return priced;
}

/** A bus/tram leg in the Görlitz–Zgorzelec area of an agency without "zvon": no source, so the amount is UNKNOWN (0 = no price). */
export function priceGorlitzAreaUnconfirmedLeg(leg: Leg): PricedLeg {
  const reason = `Odcinek w obszarze Görlitz–Zgorzelec operatora '${leg.carrier_name}' (agencja bez 'ZVON' w danych MOTIS) — brak potwierdzonej taryfy dla tego operatora.`;
  return makePricedLeg({
    leg,
    amount: 0.0,
    currency: "PLN",
    price_type: "szacunek",
    notes: `${reason} Kwota nieznana — NIE wliczona w sumę (0,00 oznacza brak ceny).`,
    breakdown: {
      price_verified: false,
      cena_nieznana: true,
      powod_szacunku: "Görlitz–Zgorzelec: operator spoza ZVON, brak potwierdzonej taryfy",
    },
  });
}

export const isTrainLikeLine = (leg: Leg): boolean =>
  TRAIN_LINE_PATTERN.test((truthy(leg.extra["route_short_name"]) ? String(leg.extra["route_short_name"]) : "").trim());

export function priceLongUnknownLocalLeg(leg: Leg): PricedLeg {
  const priced = fallbackPricedLeg(
    leg,
    `Nieznany operator '${leg.carrier_name}' poza obsługiwanymi miastami i NRW; odcinek ${formatFixed(leg.distance_km as number, 0)} km jest dłuższy niż ${formatFixed(LOCAL_BUS_MAX_KM, 0)} km, więc bez ryczałtu lokalnego.`,
  );
  priced.breakdown["powod_szacunku"] = LONG_LOCAL_LEG_REASON;
  priced.breakdown["prog_ryczaltu_km"] = LOCAL_BUS_MAX_KM;
  if (isTrainLikeLine(leg)) {
    const route = String(leg.extra["route_short_name"]).trim();
    priced.breakdown["sygnal_linii"] = `oznaczenie linii ${route} wskazuje na pociąg (niepotwierdzone)`;
    priced.notes = `${priced.notes} Oznaczenie linii ${route} sugeruje pociąg, ale feed podaje autobus — tryb niepotwierdzony.`;
  }
  return priced;
}

/** Local transport leg (MOTIS bus/tram/metro/SUBURBAN): the Verbund tariffs cover every local mode in their area, whoever operates. */
export function priceBusLeg(leg: Leg, discountsIn: DiscountProfile | null = null): PricedLeg {
  const discounts = discountsIn ?? defaultProfile();

  const isCoach = extraGet(leg, "motis_mode") === "COACH" || LONG_DISTANCE_COACH_KEYWORDS.some((k) => lower(leg.carrier_name).includes(k));
  if (isCoach) {
    if (lower(leg.carrier_name).includes("flix")) return priceFlixbusLeg(leg);
    return fallbackPricedLeg(leg, "Autokar dalekobieżny — brak modułu taryf.");
  }

  if (isZvonEuropastadtLeg(leg)) {
    const result = estimatePrice(makeSegment({ carrier: Carrier.ZVON_GORLITZ, origin: leg.origin_name, destination: leg.destination_name, discounts }));
    return fromEstimate(leg, result, Carrier.ZVON_GORLITZ, { breakdown: result.breakdown });
  }

  const covered = deutschlandticketLeg(leg, discounts);
  if (covered !== null) return covered;

  const localCarrier = inferPlLocalRailCarrier(leg);
  if (localCarrier !== null) return pricePlLocalRailLeg(leg, localCarrier, discounts);

  const carrier = cityCarrierForLeg(leg);
  if (carrier === Carrier.ZTM_WARSZAWA && isKmOrWkd(leg)) return kmWkdWithoutZtmTickets(leg);
  if (carrier !== null) {
    try {
      const result = estimatePrice(
        makeSegment({
          carrier,
          origin: leg.origin_name,
          destination: leg.destination_name,
          ride_duration_min: legDurationMin(leg),
          discounts,
          tariff_zone: carrier === Carrier.BVG_BERLIN ? bvgTariffZone(leg) : null,
        }),
      );
      return fromEstimate(leg, result, carrier, { breakdown: result.breakdown });
    } catch (e) {
      if (e instanceof ValueError) return calculatorError(leg, carrier, e);
      throw e;
    }
  }

  // eezy.nrw (VRR) covers all local transport in NRW, but ONLY NRW (the GTFS covers all of Germany).
  if (isLegInNrw(leg) && leg.distance_km !== null) {
    try {
      const result = estimatePrice(
        makeSegment({ carrier: Carrier.VRR, origin: leg.origin_name, destination: leg.destination_name, distance_km: leg.distance_km, discounts }),
      );
      return fromEstimate(leg, result, Carrier.VRR, { breakdown: result.breakdown });
    } catch (e) {
      if (e instanceof ValueError) return calculatorError(leg, Carrier.VRR, e);
      throw e;
    }
  }

  if (isSuburbanLeg(leg)) return priceSuburbanLeg(leg);
  if (isInZvonGorlitzArea(leg)) return priceGorlitzAreaUnconfirmedLeg(leg);
  if (leg.distance_km !== null && leg.distance_km > LOCAL_BUS_MAX_KM) return priceLongUnknownLocalLeg(leg);

  return makePricedLeg({
    leg,
    amount: LOCAL_BUS_FLAT_PLN,
    currency: "PLN",
    price_type: "szacunek",
    notes: `Nieznany operator lokalny '${leg.carrier_name}' poza obsługiwanymi miastami i NRW — placeholder ${formatFixed(LOCAL_BUS_FLAT_PLN, 2)} PLN, cena niepotwierdzona (nie z cennika).`,
    breakdown: { price_verified: false, wartosc_zastepcza: true, powod_szacunku: "nieznany operator lokalny" },
  });
}

export const priceWalkLeg = (leg: Leg): PricedLeg =>
  makePricedLeg({ leg, amount: 0.0, currency: "PLN", price_type: "oficjalna_taryfa", notes: "Dojście pieszo." });

/** Flights are not ported (they need the Travelpayouts API): a flight leg must be priced by the caller. */
export function priceLeg(leg: Leg, discounts: DiscountProfile): PricedLeg {
  if (leg.mode === LegMode.RAIL) return priceRailLeg(leg, discounts);
  if (leg.mode === LegMode.BUS) return priceBusLeg(leg, discounts);
  if (leg.mode === LegMode.WALK) return priceWalkLeg(leg);
  if (leg.mode === LegMode.FLIGHT) throw new ValueError("lot: wycena lotów nie jest wdrożona w core (wymaga Travelpayouts)");
  throw new ValueError(`nieznany LegMode: ${leg.mode}`);
}
