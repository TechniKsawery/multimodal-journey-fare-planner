// Client for the public Transitous API (MOTIS 2). Policy: https://transitous.org/api/
// - non-commercial, open-source projects only; keep the request volume low (>720 /plan per day
//   needs to be agreed with the Transitous team) -> every client here has a hard daily budget,
//   a short-lived cache and debounce is expected in the UI.
// - Attribution + contact data must be visible in the app (see App.tsx footer).

export const TRANSITOUS_BASE = "https://api.transitous.org/api";

export type LegMode =
  | "WALK" | "BIKE" | "CAR" | "BUS" | "COACH" | "TRAM" | "SUBWAY" | "FERRY"
  | "HIGHSPEED_RAIL" | "LONG_DISTANCE" | "NIGHT_RAIL" | "REGIONAL_FAST_RAIL"
  | "REGIONAL_RAIL" | "SUBURBAN" | "RAIL" | "TRANSIT" | "OTHER" | (string & {});

export interface Place {
  name: string;
  lat: number;
  lon: number;
  stopId?: string;
  departure?: string;
  arrival?: string;
  scheduledDeparture?: string;
  scheduledArrival?: string;
  tz?: string;
}

export interface Leg {
  mode: LegMode;
  from: Place;
  to: Place;
  startTime: string;
  endTime: string;
  duration: number; // seconds
  distance?: number; // metres
  agencyName?: string;
  routeShortName?: string;
  headsign?: string;
  tripId?: string;
  legGeometry?: { points: string; precision: number; length: number };
}

export interface Itinerary {
  startTime: string;
  endTime: string;
  duration: number; // seconds
  transfers: number;
  legs: Leg[];
}

export interface PlanResponse {
  itineraries: Itinerary[];
  pageCursor?: string;
  nextPageCursor?: string;
  previousPageCursor?: string;
}

export interface GeocodeMatch {
  type: "STOP" | "ADDRESS" | "PLACE" | string;
  id?: string;
  name: string;
  lat: number;
  lon: number;
  country?: string;
  areas?: { name: string; adminLevel?: number; default?: boolean }[];
}

/** Hard cap on /plan requests one client may send per UTC day (policy: stay far below 720 total). */
export const DEFAULT_DAILY_PLAN_BUDGET = 40;
export const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safeStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Per-day request counter, kept in localStorage (best effort; works without storage too). */
export class QueryBudget {
  private memory = new Map<string, number>();
  constructor(
    private readonly limit: number = DEFAULT_DAILY_PLAN_BUDGET,
    private readonly storage: KeyValueStorage | null = safeStorage(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private key(): string {
    return `plan-budget:${this.now().toISOString().slice(0, 10)}`;
  }

  used(): number {
    const k = this.key();
    try {
      const raw = this.storage?.getItem(k);
      if (raw != null) return Number(raw) || 0;
    } catch {
      /* ignore */
    }
    return this.memory.get(k) ?? 0;
  }

  remaining(): number {
    return Math.max(0, this.limit - this.used());
  }

  /** Reserve one request; returns false (and reserves nothing) when the budget is spent. */
  take(): boolean {
    if (this.remaining() <= 0) return false;
    const k = this.key();
    const next = this.used() + 1;
    this.memory.set(k, next);
    try {
      this.storage?.setItem(k, String(next));
    } catch {
      /* ignore */
    }
    return true;
  }
}

export class BudgetExceededError extends Error {
  constructor() {
    super("Daily routing request budget exhausted");
    this.name = "BudgetExceededError";
  }
}

export class TransitousError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TransitousError";
  }
}

export interface PlanQuery {
  /** Stop id (preferred) or "lat,lon". */
  from: string;
  to: string;
  /** ISO 8601 departure time. */
  time: string;
  numItineraries?: number;
  maxTransfers?: number;
}

export function buildPlanUrl(q: PlanQuery, base = TRANSITOUS_BASE): string {
  const p = new URLSearchParams({
    fromPlace: q.from,
    toPlace: q.to,
    time: q.time,
    numItineraries: String(q.numItineraries ?? 5),
    maxTransfers: String(q.maxTransfers ?? 4),
  });
  return `${base}/v6/plan?${p.toString()}`;
}

export function buildGeocodeUrl(text: string, language = "en", base = TRANSITOUS_BASE): string {
  return `${base}/v1/geocode?${new URLSearchParams({ text, language }).toString()}`;
}

/** Place argument for /plan: a stop id when the match is a stop, otherwise coordinates. */
export function placeArg(m: GeocodeMatch): string {
  return m.type === "STOP" && m.id ? m.id : `${m.lat},${m.lon}`;
}

export class TransitousClient {
  private cache = new Map<string, { at: number; value: unknown }>();
  readonly budget: QueryBudget;
  constructor(
    private readonly opts: {
      base?: string;
      fetchImpl?: typeof fetch;
      budget?: QueryBudget;
      cacheTtlMs?: number;
      now?: () => number;
    } = {},
  ) {
    this.budget = opts.budget ?? new QueryBudget();
  }

  private async getJson<T>(url: string, signal?: AbortSignal, counted = false): Promise<T> {
    const now = (this.opts.now ?? Date.now)();
    const ttl = this.opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    const hit = this.cache.get(url);
    if (hit && now - hit.at < ttl) return hit.value as T;
    if (counted && !this.budget.take()) throw new BudgetExceededError();
    const f = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(url, { signal, headers: { Accept: "application/json" } });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new TransitousError("Network error while contacting the routing service");
    }
    if (!res.ok) {
      throw new TransitousError(
        res.status === 429 ? "Routing service is busy (429)" : `Routing service error (${res.status})`,
        res.status,
      );
    }
    const value = (await res.json()) as T;
    this.cache.set(url, { at: now, value });
    return value;
  }

  geocode(text: string, language = "en", signal?: AbortSignal): Promise<GeocodeMatch[]> {
    return this.getJson<GeocodeMatch[]>(buildGeocodeUrl(text, language, this.opts.base), signal);
  }

  plan(q: PlanQuery, signal?: AbortSignal): Promise<PlanResponse> {
    return this.getJson<PlanResponse>(buildPlanUrl(q, this.opts.base), signal, true);
  }
}
