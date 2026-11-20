// Client of the public Transitous API (MOTIS 2): geocoding and /api/v6/plan, built for a browser/app.
// Pure module: `fetch`, clock and sleep are injected, nothing global is touched, so it runs the same
// in the PWA, a Web Worker, Capacitor and tests. Port of the I/O half of routing/motis_client.py,
// plus what a public instance needs: a per-search request BUDGET, a response cache with in-flight
// de-duplication, retry with backoff on 429/5xx, and a timeout.
//
// Transitous policy (https://transitous.org/api/): many /plan requests (> 720/24h) and many users
// must be agreed with the operators, and the service is best-effort. Hence the defaults: a "fast"
// search spends at most FAST_SEARCH_BUDGET requests, the oracle's heavy 30-itinerary query is
// opt-in ("extended").
import { msg } from "../i18n/msg";
import { BudgetExceededError, MotisError } from "./errors";
import { itineraryToLegs, allItineraries, haversineKm, matchAreas, MAX_WALK_SECONDS, TRANSFER_BUFFER_MINUTES, MAIN_QUERY_ITINERARIES, type Raw } from "./motis";
import type { Leg } from "./model";

export const TRANSITOUS_BASE_URL = "https://api.transitous.org";
/** Requests one fast search may send (cache hits are free; retries count). */
export const FAST_SEARCH_BUDGET = 2;
/** Requests one extended search may send. */
export const EXTENDED_SEARCH_BUDGET = 12;
export const FAST_QUERY_ITINERARIES = 8;
export const PLAN_CACHE_TTL_MS = 15 * 60_000;
export const GEOCODE_CACHE_TTL_MS = 5 * 60_000;
export const CACHE_MAX_ENTRIES = 256;
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_RETRIES = 2;
export const STOP_MATCH_RADIUS_KM = 5.0;

/** Counts the requests ONE search sends. Create one per user search and pass it to every call. */
export class QueryBudget {
  private used = 0;
  constructor(readonly limit: number) {}
  get spent(): number {
    return this.used;
  }
  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }
  /** Reserves one request or throws BudgetExceededError. */
  take(): void {
    if (this.used >= this.limit) throw new BudgetExceededError(this.limit);
    this.used += 1;
  }
}

export const fastBudget = (): QueryBudget => new QueryBudget(FAST_SEARCH_BUDGET);
export const extendedBudget = (): QueryBudget => new QueryBudget(EXTENDED_SEARCH_BUDGET);

export interface TransitousOptions {
  /** Base URL; https only (plain http only for localhost, e.g. a self-hosted MOTIS). */
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number; // ms, monotonic enough for TTLs
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
  planCacheTtlMs?: number;
  geocodeCacheTtlMs?: number;
}

export interface ClientStats {
  requests: number; // network requests sent (retries included)
  cacheHits: number;
  retries: number;
}

export interface GeocodeSuggestion {
  lat: number;
  lon: number;
  name: string;
  type?: string;
  category?: string;
  country?: string;
  areas?: { name: string; adminLevel: number }[];
}

export interface PlanOptions {
  maxTransfers?: number;
  numItineraries?: number;
  budget?: QueryBudget;
  signal?: AbortSignal;
}

export interface StopRef {
  name: string;
  lat: number;
  lon: number;
}

export function validateBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MotisError(msg("err.motis_request", { url: raw, error: "invalid base URL" }));
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new MotisError(msg("err.motis_request", { url: raw, error: "base URL must be https (http only for localhost)" }));
  }
  if (url.username || url.password) {
    throw new MotisError(msg("err.motis_request", { url: url.origin, error: "credentials in the base URL are not allowed" }));
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

class TtlCache<T> {
  private readonly map = new Map<string, { at: number; value: T }>();
  constructor(private readonly ttlMs: number, private readonly max: number) {}
  get(key: string, now: number): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (now - hit.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: T, now: number): void {
    while (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { at: now, value });
  }
  clear(): void {
    this.map.clear();
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

export function createTransitousClient(options: TransitousOptions = {}) {
  const baseUrl = validateBaseUrl(options.baseUrl ?? TRANSITOUS_BASE_URL);
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const stats: ClientStats = { requests: 0, cacheHits: 0, retries: 0 };
  const planCache = new TtlCache<Raw>(options.planCacheTtlMs ?? PLAN_CACHE_TTL_MS, CACHE_MAX_ENTRIES);
  const geocodeCache = new TtlCache<Raw[]>(options.geocodeCacheTtlMs ?? GEOCODE_CACHE_TTL_MS, CACHE_MAX_ENTRIES);
  const reverseCache = new Map<string, { name: string; adminLevel: number }[]>();
  const stopIdCache = new Map<string, string>();
  const inflight = new Map<string, Promise<unknown>>();

  /** One GET with timeout, retry (429/5xx/network) and budget accounting. Resolves to {status, body}. */
  async function request(
    path: string,
    params: Record<string, string | number>,
    budget: QueryBudget | undefined,
    signal: AbortSignal | undefined,
    errorKey: "err.motis_geocode" | "err.motis_request",
  ): Promise<{ status: number; body: unknown }> {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    let lastError = "";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      budget?.take();
      stats.requests += 1;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const onAbort = () => ctrl.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      let retryAfterMs = 0;
      try {
        const res = await doFetch(url.toString(), { method: "GET", headers: { Accept: "application/json" }, credentials: "omit", signal: ctrl.signal });
        if (res.status === 429 || res.status >= 500) {
          lastError = `HTTP ${res.status}`;
          const ra = Number(res.headers?.get?.("Retry-After"));
          retryAfterMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : 0;
        } else {
          let body: unknown = null;
          try {
            body = await res.json();
          } catch {
            body = null;
          }
          if (res.status >= 400 && res.status !== 400) throw new MotisError(msg(errorKey, { url: baseUrl, error: `HTTP ${res.status}` }));
          return { status: res.status, body };
        }
      } catch (e) {
        if (e instanceof MotisError) throw e;
        if (signal?.aborted) throw new MotisError(msg(errorKey, { url: baseUrl, error: "aborted" }));
        lastError = e instanceof Error ? e.message || e.name : String(e);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
      if (attempt < maxRetries) {
        stats.retries += 1;
        await sleep(retryAfterMs || 500 * 2 ** attempt);
      }
    }
    throw new MotisError(msg(errorKey, { url: baseUrl, error: lastError }));
  }

  /** De-duplicates identical concurrent requests (typing fast, double submit). */
  function once<T>(key: string, run: () => Promise<T>): Promise<T> {
    const running = inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = run().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function geocodeRaw(text: string, signal?: AbortSignal): Promise<Raw[]> {
    const key = text.toLowerCase().split(/\s+/u).filter(Boolean).join(" ");
    const hit = geocodeCache.get(key, now());
    if (hit) {
      stats.cacheHits += 1;
      return hit;
    }
    return once(`g:${key}`, async () => {
      const { body } = await request("/api/v1/geocode", { text }, undefined, signal, "err.motis_geocode");
      if (!Array.isArray(body)) throw new MotisError(msg("err.motis_geocode", { url: baseUrl, error: "unexpected response" }));
      const rows = body.filter(isObject);
      geocodeCache.set(key, rows, now());
      return rows;
    });
  }

  /** Place suggestions for typing: [{lat, lon, name, ...}]. Empty text or no match -> []. Geocoding never spends a plan budget. */
  async function geocodeSuggestions(text: string, limit = 5, signal?: AbortSignal): Promise<GeocodeSuggestion[]> {
    if (!text || !text.trim()) return [];
    const results = await geocodeRaw(text, signal);
    return results.slice(0, limit).map((r) => {
      const s: GeocodeSuggestion = { lat: r["lat"], lon: r["lon"], name: r["name"] || text };
      for (const field of ["type", "category", "country"] as const) if (r[field]) s[field] = r[field];
      const areas = matchAreas(r);
      if (areas.length > 0) s.areas = areas;
      return s;
    });
  }

  async function geocode(text: string, signal?: AbortSignal): Promise<[number, number, string]> {
    const [best] = await geocodeSuggestions(text, 1, signal);
    if (!best) throw new MotisError(msg("err.motis_address_not_found", { text: JSON.stringify(text) }));
    return [best.lat, best.lon, best.name];
  }

  async function reverseGeocodeAreas(lat: number, lon: number, signal?: AbortSignal) {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const hit = reverseCache.get(key);
    if (hit) return hit.map((a) => ({ ...a }));
    const { body } = await request("/api/v1/reverse-geocode", { place: `${lat},${lon}` }, undefined, signal, "err.motis_geocode");
    if (!Array.isArray(body)) throw new MotisError(msg("err.motis_geocode", { url: baseUrl, error: "unexpected response" }));
    let areas: { name: string; adminLevel: number }[] = [];
    for (const m of body.filter(isObject)) {
      const a = matchAreas(m);
      if (a.length > 0) {
        areas = a;
        break;
      }
    }
    while (reverseCache.size >= CACHE_MAX_ENTRIES) reverseCache.delete(reverseCache.keys().next().value as string);
    reverseCache.set(key, areas);
    return areas.map((a) => ({ ...a }));
  }

  /** Resolves a stop given by name and coordinates to a MOTIS stopId (nearest STOP within the radius). */
  async function findStopId(ref: StopRef, signal?: AbortSignal): Promise<string> {
    const cacheKey = `${ref.name}|${ref.lat}|${ref.lon}`;
    const cached = stopIdCache.get(cacheKey);
    if (cached) return cached;
    let bestId: string | null = null;
    let bestKm = STOP_MATCH_RADIUS_KM;
    for (const r of await geocodeRaw(ref.name, signal)) {
      if (r["type"] !== "STOP" || !r["id"]) continue;
      const km = haversineKm(ref.lat, ref.lon, r["lat"], r["lon"]);
      if (km <= bestKm) {
        bestId = r["id"];
        bestKm = km;
      }
    }
    if (bestId === null) {
      throw new MotisError(msg("err.motis_stop_not_found", { name: JSON.stringify(ref.name), radius: STOP_MATCH_RADIUS_KM, lat: ref.lat, lon: ref.lon }));
    }
    stopIdCache.set(cacheKey, bestId);
    return bestId;
  }

  /** GET /api/v6/plan: the raw response, checked for itineraries. Cached; each network request costs one budget unit. */
  async function plan(fromPlace: string, toPlace: string, time: string, opts: PlanOptions = {}): Promise<Raw> {
    const maxTransfers = opts.maxTransfers ?? 4;
    const params: Record<string, string | number> = {
      ...(opts.numItineraries ? { numItineraries: opts.numItineraries, additionalTransferTime: TRANSFER_BUFFER_MINUTES } : {}),
      fromPlace,
      toPlace,
      time,
      maxTransfers,
      // the default walking limit is short; far-from-station addresses would give 0 results
      maxPreTransitTime: MAX_WALK_SECONDS,
      maxPostTransitTime: MAX_WALK_SECONDS,
    };
    const key = JSON.stringify(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)));
    let payload = planCache.get(key, now());
    if (payload) {
      stats.cacheHits += 1;
    } else {
      payload = await once(`p:${key}`, async () => {
        const { status, body } = await request("/api/v6/plan", params, opts.budget, opts.signal, "err.motis_request");
        if (status === 400) {
          const detail = isObject(body) ? body["error"] : null;
          if (detail) throw new MotisError(msg("err.motis_rejected", { detail }));
          throw new MotisError(msg("err.motis_request", { url: baseUrl, error: "HTTP 400" }));
        }
        if (!isObject(body)) throw new MotisError(msg("err.motis_request", { url: baseUrl, error: "unexpected response" }));
        planCache.set(key, body, now());
        return body;
      });
    }
    if (allItineraries(payload).length === 0) {
      throw new MotisError(msg("err.motis_no_itinerary", { origin: fromPlace, destination: toPlace, time, minutes: Math.floor(MAX_WALK_SECONDS / 60) }));
    }
    return payload;
  }

  /**
   * Itineraries of one relation as legs, fastest first. `mode` picks the query weight:
   * "fast" asks for FAST_QUERY_ITINERARIES, "extended" for the oracle's MAIN_QUERY_ITINERARIES.
   */
  async function planLegCandidates(
    fromPlace: string,
    toPlace: string,
    time: string,
    maxCandidates = 3,
    opts: Omit<PlanOptions, "numItineraries" | "maxTransfers"> & { mode?: "fast" | "extended" } = {},
  ): Promise<Leg[][]> {
    const n = opts.mode === "extended" ? MAIN_QUERY_ITINERARIES : Math.max(maxCandidates, FAST_QUERY_ITINERARIES);
    const payload = await plan(fromPlace, toPlace, time, { maxTransfers: 5, numItineraries: n, budget: opts.budget, signal: opts.signal });
    return [...allItineraries(payload)]
      .sort((a, b) => a["duration"] - b["duration"]) // stable, like Python sorted
      .slice(0, maxCandidates)
      .map(itineraryToLegs);
  }

  return {
    baseUrl,
    stats,
    geocodeSuggestions,
    geocode,
    reverseGeocodeAreas,
    findStopId,
    plan,
    planLegCandidates,
    clearCaches(): void {
      planCache.clear();
      geocodeCache.clear();
      reverseCache.clear();
      stopIdCache.clear();
    },
  };
}

export type TransitousClient = ReturnType<typeof createTransitousClient>;
