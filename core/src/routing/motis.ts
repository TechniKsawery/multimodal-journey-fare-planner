// Port of the pure parts of routing/motis_client.py: geometry helpers, track distance and the
// conversion of a MOTIS/Transitous itinerary into legs. No I/O here (see transitousClient.ts).
import { ValueError } from "../pyCompat";
import { LegMode, makeLeg, type Leg } from "./model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = Record<string, any>;

export const TRANSFER_BUFFER_MINUTES = 10; // additionalTransferTime: search with slack instead of "just-in-time" transfers
export const MAIN_QUERY_ITINERARIES = 30; // the oracle's value; the Transitous client defaults to far fewer (see budget)
export const MAX_WALK_SECONDS = 3600; // up to an hour on foot to/from the first/last stop

/** Python `datetime.fromisoformat(value.replace("Z", "+00:00"))` as an instant. */
export function parseTime(value: string): Date {
  if (typeof value !== "string") throw new ValueError("fromisoformat: argument must be str");
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValueError(`Invalid isoformat string: '${value}'`);
  return d;
}

/** Great-circle distance in km (used as distance_km for fares). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371.0;
  const rad = (d: number) => (d * Math.PI) / 180;
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dphi = rad(lat2 - lat1);
  const dlambda = rad(lon2 - lon1);
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlambda / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

/**
 * Decodes a Google encoded polyline (how MOTIS encodes `legGeometry`) to [lat, lon] pairs.
 * Arithmetic instead of bit operations: 32-bit shifts would overflow for 7-digit precision.
 */
export function decodePolyline(points: string, precision = 6): [number, number][] {
  const factor = 10.0 ** precision;
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < points.length) {
    const deltas: number[] = [];
    for (let k = 0; k < 2; k++) {
      let result = 0;
      let scale = 1;
      for (;;) {
        if (index >= points.length) throw new ValueError("polyline truncated");
        const chunk = points.charCodeAt(index) - 63;
        index += 1;
        result += (chunk & 0x1f) * scale;
        scale *= 32;
        if (chunk < 0x20) break;
      }
      deltas.push(result % 2 === 1 ? -Math.floor(result / 2) - 1 : result / 2);
    }
    lat += deltas[0];
    lon += deltas[1];
    coords.push([lat / factor, lon / factor]);
  }
  return coords;
}

function pathKm(path: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i + 1 < path.length; i++) sum += haversineKm(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
  return sum;
}

// Labels of the track-km source (they end up in Segment.distance_source and the price breakdown).
export const TRACK_KM_GEOMETRY = "geometria odcinka z MOTIS (legGeometry)";
export const TRACK_KM_STOPS = "suma odległości między przystankami pośrednimi z MOTIS (intermediateStops)";

// The geometry must end near the leg's end stations; a farther shape is not this route.
export const GEOMETRY_ENDPOINT_TOLERANCE_KM = 2.0;

function geometryPath(raw: Raw): [number, number][] | null {
  const geometry = (raw["legGeometry"] ?? {}) as Raw;
  if (!geometry["points"]) return null;
  const path = decodePolyline(String(geometry["points"]), geometry["precision"] || 6);
  if (path.length < 3) return null;
  const { from: origin, to: destination } = raw;
  const first = path[0];
  const last = path[path.length - 1];
  if (
    haversineKm(first[0], first[1], origin["lat"], origin["lon"]) > GEOMETRY_ENDPOINT_TOLERANCE_KM ||
    haversineKm(last[0], last[1], destination["lat"], destination["lon"]) > GEOMETRY_ENDPOINT_TOLERANCE_KM
  ) {
    return null;
  }
  return path;
}

function stopsPath(raw: Raw): [number, number][] | null {
  const stops = (raw["intermediateStops"] ?? []) as Raw[];
  if (stops.length === 0) return null;
  const points = [raw["from"], ...stops, raw["to"]] as Raw[];
  if (points.some((p) => p["lat"] == null || p["lon"] == null)) return null;
  return points.map((p) => [p["lat"], p["lon"]] as [number, number]);
}

/**
 * Length of a transit leg measured along the train's route (not as the crow flies), from what MOTIS
 * returns: the `legGeometry` shape or the polyline through `intermediateStops`. Both are sums of
 * straight segments, i.e. a lower bound of the track length; the longer of the two wins. No
 * correction factor. Returns [km, source label] or null when the response carries nothing more.
 */
export function trackDistanceKm(raw: Raw): [number, string] | null {
  const candidates: [number, string][] = [];
  for (const [path, label] of [
    [geometryPath(raw), TRACK_KM_GEOMETRY],
    [stopsPath(raw), TRACK_KM_STOPS],
  ] as const) {
    if (path && path.length > 0) candidates.push([pathKm(path), label]);
  }
  let best: [number, string] | null = null;
  for (const c of candidates) if (best === null || c[0] > best[0]) best = c; // first maximum wins, like Python max()
  return best;
}

/** Itineraries with transit AND the direct ones (`direct`, pure door-to-door walking). */
export function allItineraries(payload: Raw): Raw[] {
  return [...((payload["itineraries"] ?? []) as Raw[]), ...((payload["direct"] ?? []) as Raw[])];
}

export function fastestItinerary(payload: Raw): Raw {
  const all = allItineraries(payload);
  if (all.length === 0) throw new ValueError("min() arg is an empty sequence");
  let best = all[0];
  for (const it of all) if (it["duration"] < best["duration"]) best = it;
  return best;
}

export function fewestTransfersItinerary(payload: Raw): Raw {
  const all = allItineraries(payload);
  if (all.length === 0) throw new ValueError("min() arg is an empty sequence");
  const key = (it: Raw): [number, number] => [it["transfers"] ?? 0, it["duration"]];
  let best = all[0];
  for (const it of all) {
    const [a, b] = [key(it), key(best)];
    if (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) best = it;
  }
  return best;
}

/** Administrative areas of a match as [{name, adminLevel}] (OSM admin_level: 2 country, 4 voivodeship/state, ...). */
export function matchAreas(match: Raw): { name: string; adminLevel: number }[] {
  return ((match["areas"] ?? []) as Raw[])
    .filter((a) => a["name"] && a["adminLevel"] != null)
    .map((a) => ({ name: a["name"], adminLevel: a["adminLevel"] }));
}

/**
 * Converts a MOTIS itinerary into legs. WALK legs at the start/end (access from an address / egress
 * to one) become WALK legs; WALK legs between transit legs only mark `requires_walk`. MOTIS RAIL
 * modes and TRAIN map to RAIL, the rest of transit (tram/metro/bus/SUBURBAN) to BUS; suburban
 * rail is priced by its own path, not by the bus flat rate.
 */
export function itineraryToLegs(itinerary: Raw): Leg[] {
  const rawLegs = itinerary["legs"] as Raw[];
  const legs: Leg[] = [];
  let precededByWalk = false;
  const lastIndex = rawLegs.length - 1;

  rawLegs.forEach((raw, idx) => {
    const origin = raw["from"] as Raw;
    const destination = raw["to"] as Raw;
    const distanceKm = haversineKm(origin["lat"], origin["lon"], destination["lat"], destination["lon"]);
    const common = {
      origin_name: origin["name"] as string,
      destination_name: destination["name"] as string,
      depart: parseTime(raw["startTime"]),
      arrive: parseTime(raw["endTime"]),
      distance_km: distanceKm,
    };

    if (raw["mode"] === "WALK") {
      if (idx === 0 || idx === lastIndex) {
        const access = idx === 0;
        legs.push(
          makeLeg({
            mode: LegMode.WALK,
            carrier_name: "pieszo",
            requires_walk: false,
            extra: {
              motis_mode: "WALK",
              walk_role: access ? "dojscie" : "dojscie_do_celu",
              walk_distance_m: raw["distance"] ?? null,
            },
            ...common,
          }),
        );
      } else {
        precededByWalk = true;
      }
      return;
    }

    const mode = String(raw["mode"]).includes("RAIL") || raw["mode"] === "TRAIN" ? LegMode.RAIL : LegMode.BUS;
    const hasPrevTransit = legs.some((l) => l.mode !== LegMode.WALK);
    const extra: Record<string, unknown> = {
      motis_mode: raw["mode"],
      route_short_name: raw["routeShortName"] ?? null,
      origin_stop_id: origin["stopId"] ?? null,
      destination_stop_id: destination["stopId"] ?? null,
      origin_lat: origin["lat"] ?? null,
      origin_lon: origin["lon"] ?? null,
      destination_lat: destination["lat"] ?? null,
      destination_lon: destination["lon"] ?? null,
    };
    const track = trackDistanceKm(raw);
    if (track !== null) [extra["distance_along_track_km"], extra["distance_along_track_source"]] = track;
    legs.push(
      makeLeg({
        mode,
        carrier_name: raw["agencyName"] || raw["routeShortName"] || "",
        requires_walk: hasPrevTransit ? precededByWalk : false,
        extra,
        ...common,
      }),
    );
    precededByWalk = false;
  });

  return legs;
}
