// Port of the rail part of routing/variants.py: builds the route variants of one search from a routing client.
//
// What is ported: the main origin->destination query (all itineraries as rail-only variants), the other-day hint,
// the "rail via a hub stop" variant, alternative origin/destination stations and the shared de-duplication.
// What is NOT ported: the flight hubs (rail + flight + rail, flight + regional) — flights have no live prices here
// (see PRICING_GAPS.md), so `generateVariants` never builds them.
//
// The routing client is a small interface (`RoutingClient`): the real Transitous client (transitousClient.ts)
// satisfies it, and so does a fake in tests. A search spends a query budget (see QueryBudget): in "fast" mode only the
// main query is made; "extended" adds the via-hub and alternative-station queries (the oracle's full behaviour).
import type { DiscountProfile } from "../fares/model";
import { defaultProfile } from "../fares/model";
import { transportModeName } from "../i18n";
import { joined, msg, type Msg, type Text } from "../i18n/msg";
import { formatFixed } from "../pyCompat";
import { MotisError } from "./errors";
import {
  LegMode,
  makeOtherDayVariant,
  type Itinerary,
  type Leg,
  type OtherDayVariant,
  type SkippedVariant,
} from "./model";
import { allItineraries, fastestItinerary, haversineKm, itineraryToLegs, MAIN_QUERY_ITINERARIES, type Raw } from "./motis";
import { applyKdDresdenPromotion, priceLeg } from "./pricing";
import { buildItinerary } from "./scoring";
import { MIN_TRANSFER_MINUTES_WALK } from "./transfers";
import { FAST_QUERY_ITINERARIES, type QueryBudget, type StopRef } from "./transitousClient";

/** The zone in which the user gives the date and time of departure (PL/DE timetables are local time). */
export const LOCAL_TIMEZONE = "Europe/Warsaw";

/** What the variants need from a routing service; `createTransitousClient()` satisfies it. */
export interface RoutingClient {
  plan(
    fromPlace: string,
    toPlace: string,
    time: string,
    opts?: { maxTransfers?: number; numItineraries?: number; budget?: QueryBudget; signal?: AbortSignal },
  ): Promise<Raw>;
  findStopId(ref: StopRef, signal?: AbortSignal): Promise<string>;
}

export type SearchMode = "fast" | "extended";

export interface VariantOptions {
  mode?: SearchMode;
  budget?: QueryBudget;
  signal?: AbortSignal;
}

/** A search request: a pair of places (MOTIS stop ids or "lat,lon") + the departure day. */
export interface RouteRequest {
  origin_stop_id: string;
  destination_stop_id: string;
  origin_label: string;
  destination_label: string;
  date: string; // YYYY-MM-DD, day of departure
  departure_time: string; // HH:MM:SS, the earliest departure considered in the queries
  discounts: DiscountProfile;
}

export function makeRouteRequest(
  init: Pick<RouteRequest, "origin_stop_id" | "destination_stop_id" | "origin_label" | "destination_label" | "date"> & Partial<RouteRequest>,
): RouteRequest {
  return { departure_time: "06:00:00", discounts: defaultProfile(), ...init };
}

// ---- local time helpers (Python: datetime.replace(tzinfo=ZoneInfo("Europe/Warsaw")), fold=0) ---------------------------

const zoneFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: LOCAL_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function zoneParts(instant: Date): { date: string; time: string } {
  const p: Record<string, string> = {};
  for (const part of zoneFormat.formatToParts(instant)) p[part.type] = part.value;
  return { date: `${p["year"]}-${p["month"]}-${p["day"]}`, time: `${p["hour"]}:${p["minute"]}:${p["second"]}` };
}

/** The local (Europe/Warsaw) calendar day of an instant, YYYY-MM-DD. */
export const localDate = (instant: Date): string => zoneParts(instant).date;

function offsetString(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * The wall-clock time `date` + `time` in Warsaw as an ISO string with an offset (e.g. 2026-10-09T06:00:00+02:00).
 * Like Python's fold=0: an ambiguous time (the autumn change) takes the first occurrence (+02:00), a time that does not
 * exist (the spring change) takes the offset in force before the change (+01:00).
 */
export function localIso(date: string, time: string): string {
  const wall = `${date}T${time}`;
  const wallAsUtc = Date.parse(`${wall}Z`);
  if (Number.isNaN(wallAsUtc)) throw new RangeError(`invalid date/time: ${wall}`);
  const valid = [120, 60].filter((offsetMin) => {
    const parts = zoneParts(new Date(wallAsUtc - offsetMin * 60000));
    return `${parts.date}T${parts.time}` === wall;
  });
  const offset = valid.length > 0 ? valid[0] : 60;
  return `${wall}${offsetString(offset)}`;
}

export const motisTime = (request: RouteRequest): string => localIso(request.date, request.departure_time);

/** Python `datetime.isoformat()` of a UTC instant with "+00:00" replaced by "Z". */
export function isoZ(instant: Date): string {
  const ms = instant.getTime() % 1000;
  const base = instant.toISOString().slice(0, 19);
  return ms === 0 ? `${base}Z` : `${base}.${String(ms).padStart(3, "0")}000Z`;
}

const DAY_MS = 86_400_000;
const dayNumber = (isoDate: string): number => Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS;

// ---- shared helpers ---------------------------------------------------------------------------------------------------

const priceLegs = (legs: Leg[], request: RouteRequest) =>
  applyKdDresdenPromotion(
    legs,
    legs.map((leg) => priceLeg(leg, request.discounts)),
    request.discounts,
  );

/** True when the first leg departs on the day of the search (local time). MOTIS has no upper bound, so without this
 * filter connections of the next day show up in the results. An overnight trip that starts that evening still passes. */
export const departsOnRequestDate = (legs: Leg[], request: RouteRequest): boolean => localDate(legs[0].depart) === request.date;

export const OTHER_DAY_MAX_VARIANTS = 3;
export const OTHER_DAY_MAX_DAYS = 3;

/** An alternative stop/station/hub to try explicitly next to the main origin/destination. */
export interface AlternativeStop {
  label: string;
  stop_id: string | StopRef;
}

export const VIA_HUB_MAX_DETOUR_RATIO = 1.5;
export const SAME_STATION_RADIUS_KM = 0.5;

export type Coords = readonly [number, number];

/** Rail variant name with the (translated) kinds of transport, not raw MOTIS keys. */
export function railOnlyName(transit: Leg[]): Msg {
  const modesUsed = [...new Set(transit.map((l) => String(l.extra["motis_mode"] ?? "RAIL")))].sort();
  return msg("variant.rail_only", { modes: joined(modesUsed.map(transportModeName), "/"), transfers: transit.length - 1 });
}

/** The route as the sequence of (origin, destination) names of its legs — the same route found twice counts once. */
export const legsSignature = (legs: Leg[]): string => JSON.stringify(legs.map((l) => [l.origin_name, l.destination_name]));

const FLOAT = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/;

/** Coordinates of a place: a StopRef, or a "lat,lon" string; null for a stop id. */
export function coordsOf(place: string | StopRef): Coords | null {
  if (typeof place !== "string") return [place.lat, place.lon];
  const parts = place.split(",");
  if (parts.length !== 2 || !parts.every((p) => FLOAT.test(p))) return null;
  return [Number(parts[0]), Number(parts[1])];
}

/** Why a variant via `via` is rejected, when origin->via->destination (straight lines) exceeds the detour limit. */
export function viaHubDetourReason(origin: Coords | null, via: Coords | null, destination: Coords | null): Msg | null {
  if (!origin || !via || !destination) return null;
  const direct = haversineKm(...origin, ...destination);
  const path = haversineKm(...origin, ...via) + haversineKm(...via, ...destination);
  if (path > VIA_HUB_MAX_DETOUR_RATIO * Math.max(direct, 1.0)) {
    return msg("skip.via_detour", { path: formatFixed(path, 0), direct: formatFixed(direct, 0), ratio: VIA_HUB_MAX_DETOUR_RATIO });
  }
  return null;
}

/** Successive points of the route after the transit legs (no walks): the start of the first leg, then the end of each. */
export function transitPoints(legs: Leg[]): [string, Coords | null][] {
  const transit = legs.filter((l) => l.mode !== LegMode.WALK);
  if (transit.length === 0) return [];
  const coords = (leg: Leg, prefix: string): Coords | null => {
    const lat = leg.extra[`${prefix}_lat`];
    const lon = leg.extra[`${prefix}_lon`];
    return lat !== null && lat !== undefined && lon !== null && lon !== undefined ? [lat as number, lon as number] : null;
  };
  return [
    [transit[0].origin_name, coords(transit[0], "origin")],
    ...transit.map((leg): [string, Coords | null] => [leg.destination_name, coords(leg, "destination")]),
  ];
}

const casefold = (s: string): string => s.trim().toLowerCase().replaceAll("ß", "ss");

/** Why a route is rejected when it passes the same station twice (going back instead of forward). */
export function revisitedStationReason(legs: Leg[]): Msg | null {
  const points = transitPoints(legs);
  for (let j = 1; j < points.length; j++) {
    for (let i = 0; i < j; i++) {
      const [nameI, xyI] = points[i];
      const [nameJ, xyJ] = points[j];
      const same = xyI && xyJ ? haversineKm(...xyI, ...xyJ) <= SAME_STATION_RADIUS_KM : casefold(nameI) === casefold(nameJ);
      if (same) return msg("skip.revisited", { station: nameJ });
    }
  }
  return null;
}

// ---- variants ---------------------------------------------------------------------------------------------------------

function otherDayVariants(request: RouteRequest, options: Leg[][]): OtherDayVariant[] {
  const found: OtherDayVariant[] = [];
  for (const legs of [...options].sort((a, b) => a[0].depart.getTime() - b[0].depart.getTime())) {
    const day = localDate(legs[0].depart);
    const offset = dayNumber(day) - dayNumber(request.date);
    if (offset === 0 || Math.abs(offset) > OTHER_DAY_MAX_DAYS) continue;
    const transit = legs.filter((l) => l.mode !== LegMode.WALK);
    if (transit.length === 0) continue; // a walk alone on another day is not a connection
    const candidate = buildItinerary(railOnlyName(transit), priceLegs(legs, request));
    if (candidate.transfer_warnings.some((w) => w.infeasible)) continue;
    found.push(makeOtherDayVariant({ itinerary: candidate, date: day, requested_date: request.date, days_offset: offset }));
    if (found.length >= OTHER_DAY_MAX_VARIANTS) break;
  }
  return found;
}

function noRailReason(request: RouteRequest, total: number, otherDay: number, infeasible: number): Msg {
  if (total === 0) return msg("skip.no_connections_at_all", { time: request.departure_time, date: request.date });
  const parts: Msg[] = [];
  if (otherDay) parts.push(msg("skip.part_other_day", { n: otherDay, date: request.date }));
  if (infeasible) parts.push(msg("skip.part_infeasible", { n: infeasible }));
  return msg("skip.no_usable_connections", { total, parts: joined(parts) });
}

const isInfeasibleItinerary = (i: Itinerary): boolean => i.transfer_warnings.some((w) => w.infeasible);

export interface RailOnlyOptions extends VariantOptions {
  maxVariants?: number;
  seenSignatures?: Set<string>;
  /** Filled (in place) with the nearest connections of other days when ALL connections found are on other days. */
  otherDayOut?: OtherDayVariant[];
}

/** Up to maxVariants rail variants of ONE routing query (the itineraries the service returns anyway). */
export async function buildRailOnlyVariants(client: RoutingClient, request: RouteRequest, opts: RailOnlyOptions = {}): Promise<Itinerary[]> {
  const maxVariants = opts.maxVariants ?? 30;
  const payload = await client.plan(request.origin_stop_id, request.destination_stop_id, motisTime(request), {
    maxTransfers: 5,
    numItineraries: opts.mode === "fast" ? FAST_QUERY_ITINERARIES : MAIN_QUERY_ITINERARIES,
    budget: opts.budget,
    signal: opts.signal,
  });
  const allLegsOptions = allItineraries(payload).map(itineraryToLegs);

  const seen = opts.seenSignatures ?? new Set<string>();
  const variants: Itinerary[] = [];
  let otherDay = 0;
  let infeasible = 0;
  let duplicates = 0;
  const otherDayOptions: Leg[][] = [];
  const durationMs = (legs: Leg[]): number => legs[legs.length - 1].arrive.getTime() - legs[0].depart.getTime();
  for (const legs of [...allLegsOptions].sort((a, b) => durationMs(a) - durationMs(b))) {
    if (!departsOnRequestDate(legs, request)) {
      otherDay += 1;
      otherDayOptions.push(legs);
      continue;
    }
    const signature = legsSignature(legs);
    if (seen.has(signature)) {
      duplicates += 1;
      continue;
    }
    seen.add(signature);

    const transit = legs.filter((l) => l.mode !== LegMode.WALK);
    // no transit legs: the whole distance on foot (points in the same city)
    const name: Text = transit.length > 0 ? railOnlyName(transit) : msg("variant.walk");
    const candidate = buildItinerary(name, priceLegs(legs, request));
    if (isInfeasibleItinerary(candidate)) {
      infeasible += 1;
      continue;
    }
    variants.push(candidate);
    if (variants.length >= maxVariants) break;
  }

  const allInOtherDay = allLegsOptions.length > 0 && otherDay === allLegsOptions.length;
  if (opts.otherDayOut && allInOtherDay) opts.otherDayOut.push(...otherDayVariants(request, otherDayOptions));
  if (variants.length === 0 && duplicates === 0) {
    throw new MotisError(noRailReason(request, allLegsOptions.length, otherDay, infeasible));
  }
  return variants;
}

const resolveStop = (client: RoutingClient, place: string | StopRef, signal?: AbortSignal): Promise<string> =>
  typeof place === "string" ? Promise.resolve(place) : client.findStopId(place, signal);

async function fastestLegs(client: RoutingClient, from: string, to: string, time: string, opts: VariantOptions): Promise<Leg[]> {
  const payload = await client.plan(from, to, time, { budget: opts.budget, signal: opts.signal });
  return itineraryToLegs(fastestItinerary(payload));
}

/**
 * Rail: origin -> via -> destination as TWO separate queries, explicitly joined at the via stop. The second query does not
 * start at the arrival of the first leg but MIN_TRANSFER_MINUTES_WALK later (a transfer between two independent queries
 * has no buffer otherwise), and the change at the via stop is marked as needing a walk. A detour (the via stop is not on
 * the way, or the route comes back through the same station) ends with a MotisError with the reason.
 */
export async function buildRailViaStopVariant(client: RoutingClient, request: RouteRequest, via: AlternativeStop, opts: VariantOptions = {}): Promise<Itinerary> {
  let viaXy = coordsOf(via.stop_id);
  let originXy = coordsOf(request.origin_stop_id);
  let destXy = coordsOf(request.destination_stop_id);
  let reason = viaHubDetourReason(originXy, viaXy, destXy);
  if (reason) throw new MotisError(reason);

  const viaId = await resolveStop(client, via.stop_id, opts.signal);
  const firstLegs = await fastestLegs(client, request.origin_stop_id, viaId, motisTime(request), opts);
  if (!departsOnRequestDate(firstLegs, request)) {
    throw new MotisError(msg("skip.no_via_connection", { stop: via.label, date: request.date }));
  }
  const onward = new Date(firstLegs[firstLegs.length - 1].arrive.getTime() + MIN_TRANSFER_MINUTES_WALK * 60000);
  const secondLegs = await fastestLegs(client, viaId, request.destination_stop_id, isoZ(onward), opts);
  secondLegs[0] = { ...secondLegs[0], requires_walk: true };

  const legs = [...firstLegs, ...secondLegs];
  const points = transitPoints(legs);
  if (points.length > 0) {
    // coordinates of the legs fill in what the query itself did not tell
    originXy = originXy ?? points[0][1];
    destXy = destXy ?? points[points.length - 1][1];
    const firstPoints = transitPoints(firstLegs);
    viaXy = viaXy ?? (firstPoints.length > 0 ? firstPoints[firstPoints.length - 1][1] : null);
  }
  reason = viaHubDetourReason(originXy, viaXy, destXy) ?? revisitedStationReason(legs);
  if (reason) throw new MotisError(reason);

  return buildItinerary(msg("variant.via", { via: via.label }), priceLegs(legs, request));
}

/** Rail variants starting at an alternative station (another station of the same city), like buildRailOnlyVariants. */
export async function buildRailFromAlternativeOriginVariants(client: RoutingClient, request: RouteRequest, alt: AlternativeStop, opts: RailOnlyOptions = {}): Promise<Itinerary[]> {
  const altRequest: RouteRequest = {
    ...request,
    origin_stop_id: await resolveStop(client, alt.stop_id, opts.signal),
    origin_label: `${request.origin_label} (${alt.label})`,
  };
  return buildRailOnlyVariants(client, altRequest, { ...opts, maxVariants: opts.maxVariants ?? 10 });
}

export async function buildRailFromAlternativeDestinationVariants(client: RoutingClient, request: RouteRequest, alt: AlternativeStop, opts: RailOnlyOptions = {}): Promise<Itinerary[]> {
  const altRequest: RouteRequest = {
    ...request,
    destination_stop_id: await resolveStop(client, alt.stop_id, opts.signal),
    destination_label: `${request.destination_label} (${alt.label})`,
  };
  return buildRailOnlyVariants(client, altRequest, { ...opts, maxVariants: opts.maxVariants ?? 10 });
}

const infeasibleReason = (i: Itinerary): Msg =>
  msg("skip.infeasible", { reasons: joined(i.transfer_warnings.filter((w) => w.infeasible).map((w) => w.reason), "; ") });

const errorReason = (e: unknown): Text => (e instanceof MotisError ? e.msg : String(e));

export interface GenerateOptions extends VariantOptions {
  viaHubStops?: AlternativeStop[];
  alternativeOriginStops?: AlternativeStop[];
  alternativeDestinationStops?: AlternativeStop[];
  /** Filled (in place) only when the result is empty and the main query had connections only on other days. */
  otherDayOut?: OtherDayVariant[];
}

/**
 * All variants of a request. Variants that could not be built (no connection, a detour, the budget spent) land in `skipped`
 * with the reason instead of aborting the search. In "fast" mode only the main query is made; the via-hub and
 * alternative-station variants need the "extended" mode (each is one or two more queries). Flight hubs are not ported.
 * Only a MotisError becomes a skipped variant: an abort or a programming error propagates.
 */
export async function generateVariants(client: RoutingClient, request: RouteRequest, opts: GenerateOptions = {}): Promise<{ built: Itinerary[]; skipped: SkippedVariant[] }> {
  const built: Itinerary[] = [];
  const skipped: SkippedVariant[] = [];
  const seen = new Set<string>();
  const railOtherDay: OtherDayVariant[] = [];
  const base: VariantOptions = { mode: opts.mode, budget: opts.budget, signal: opts.signal };

  try {
    built.push(...(await buildRailOnlyVariants(client, request, { ...base, seenSignatures: seen, otherDayOut: railOtherDay })));
  } catch (e) {
    if (!(e instanceof MotisError)) throw e;
    skipped.push({ variant_name: msg("variant.rail_only_plain"), reason: e.msg });
  }

  if (opts.mode === "extended") {
    for (const via of opts.viaHubStops ?? []) {
      const label = msg("variant.via", { via: via.label });
      try {
        const candidate = await buildRailViaStopVariant(client, request, via, base);
        const signature = legsSignature(candidate.legs.map((pl) => pl.leg));
        if (seen.has(signature)) continue;
        seen.add(signature);
        if (isInfeasibleItinerary(candidate)) skipped.push({ variant_name: label, reason: infeasibleReason(candidate) });
        else built.push(candidate);
      } catch (e) {
        if (!(e instanceof MotisError)) throw e;
        skipped.push({ variant_name: label, reason: e.msg });
      }
    }

    for (const [alts, key, build] of [
      [opts.alternativeOriginStops ?? [], "variant.rail_start", buildRailFromAlternativeOriginVariants],
      [opts.alternativeDestinationStops ?? [], "variant.rail_end", buildRailFromAlternativeDestinationVariants],
    ] as const) {
      for (const alt of alts) {
        const label = msg(key, { stop: alt.label });
        try {
          for (const candidate of await build(client, request, alt, base)) {
            const signature = legsSignature(candidate.legs.map((pl) => pl.leg));
            if (seen.has(signature)) continue;
            seen.add(signature);
            built.push(candidate);
          }
        } catch (e) {
          if (!(e instanceof MotisError)) throw e;
          skipped.push({ variant_name: label, reason: errorReason(e) });
        }
      }
    }
  }

  if (opts.otherDayOut && built.length === 0) opts.otherDayOut.push(...railOtherDay);
  return { built, skipped };
}
