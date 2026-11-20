// Behaviour of the Transitous client with a fake fetch: budget, cache, retry, errors, URL safety.
import { describe, expect, it } from "vitest";
import fixture from "../../tests/fixtures/motis_kd_wroclaw_klodzko.json";
import { BudgetExceededError, MotisError } from "../src/routing/errors";
import {
  createTransitousClient,
  extendedBudget,
  fastBudget,
  QueryBudget,
  validateBaseUrl,
  FAST_SEARCH_BUDGET,
} from "../src/routing/transitousClient";

type Handler = (url: URL) => { status?: number; body?: unknown; headers?: Record<string, string> } | Promise<never>;

function setup(handler: Handler, opts: Parameters<typeof createTransitousClient>[0] = {}) {
  const calls: URL[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const r = await handler(url);
    return {
      status: r.status ?? 200,
      headers: { get: (k: string) => r.headers?.[k] ?? null },
      json: async () => r.body,
    } as unknown as Response;
  }) as typeof fetch;
  const client = createTransitousClient({
    fetch: fetchFn,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...opts,
  });
  return { client, calls, sleeps, tick: (ms: number) => (clock += ms) };
}

const PLAN = { itineraries: [fixture], direct: [] };
const planOk: Handler = () => ({ body: PLAN });
const A = "51.2,22.5";
const B = "51.5,7.1";
const T = "2026-10-20T08:00:00Z";

describe("budget", () => {
  it("a fast search spends at most FAST_SEARCH_BUDGET requests; cache hits are free", async () => {
    const { client, calls } = setup(planOk);
    const budget = fastBudget();
    await client.plan(A, B, T, { budget });
    await client.plan(A, B, T, { budget }); // cached
    expect(calls.length).toBe(1);
    expect(budget.spent).toBe(1);
    await client.plan(B, A, T, { budget });
    expect(budget.spent).toBe(FAST_SEARCH_BUDGET);
    await expect(client.plan(A, A, T, { budget })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls.length).toBe(2); // the over-budget request never left
  });
  it("extended budget is larger and a custom one is honoured", async () => {
    expect(extendedBudget().limit).toBeGreaterThan(fastBudget().limit);
    const b = new QueryBudget(0);
    expect(() => b.take()).toThrow(BudgetExceededError);
    const { client, calls } = setup(planOk);
    await expect(client.plan(A, B, T, { budget: b })).rejects.toMatchObject({ msg: { key: "err.transitous_budget", params: { limit: 0 } } });
    expect(calls.length).toBe(0);
  });
  it("retries count against the budget", async () => {
    let n = 0;
    const { client, calls } = setup(() => (++n < 3 ? { status: 503 } : { body: PLAN }));
    const budget = new QueryBudget(2);
    await expect(client.plan(A, B, T, { budget })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls.length).toBe(2);
  });
});

describe("plan", () => {
  it("sends the oracle's parameters", async () => {
    const { client, calls } = setup(planOk);
    await client.planLegCandidates(A, B, T, 3);
    const q = calls[0].searchParams;
    expect(calls[0].origin + calls[0].pathname).toBe("https://api.transitous.org/api/v6/plan");
    expect(Object.fromEntries(q)).toMatchObject({
      fromPlace: A,
      toPlace: B,
      time: T,
      maxTransfers: "5",
      maxPreTransitTime: "3600",
      maxPostTransitTime: "3600",
      additionalTransferTime: "10",
    });
    expect(Number(q.get("numItineraries"))).toBeLessThan(30); // fast mode is lighter than the oracle's 30
  });
  it("extended mode asks for the oracle's 30 itineraries", async () => {
    const { client, calls } = setup(planOk);
    await client.planLegCandidates(A, B, T, 3, { mode: "extended" });
    expect(calls[0].searchParams.get("numItineraries")).toBe("30");
  });
  it("returns legs sorted by duration, at most maxCandidates", async () => {
    const slow = { ...fixture, duration: 9999 };
    const { client } = setup(() => ({ body: { itineraries: [slow, fixture, slow], direct: [] } }));
    const res = await client.planLegCandidates(A, B, T, 2);
    expect(res.length).toBe(2);
    expect(res[0][0].carrier_name).toBe(res[1][0].carrier_name);
  });
  it("caches by query and expires after the TTL", async () => {
    const { client, calls, tick } = setup(planOk, { planCacheTtlMs: 1000 });
    await client.plan(A, B, T);
    await client.plan(A, B, T);
    expect(calls.length).toBe(1);
    expect(client.stats.cacheHits).toBe(1);
    tick(1001);
    await client.plan(A, B, T);
    expect(calls.length).toBe(2);
  });
  it("de-duplicates identical concurrent requests", async () => {
    const { client, calls } = setup(planOk);
    await Promise.all([client.plan(A, B, T), client.plan(A, B, T), client.plan(A, B, T)]);
    expect(calls.length).toBe(1);
  });
  it("HTTP 400 becomes err.motis_rejected with the server's detail", async () => {
    const { client } = setup(() => ({ status: 400, body: { error: "timetable does not cover that date" } }));
    await expect(client.plan(A, B, T)).rejects.toMatchObject({ msg: { key: "err.motis_rejected", params: { detail: "timetable does not cover that date" } } });
  });
  it("no itineraries -> err.motis_no_itinerary (the oracle's 60 min walking limit)", async () => {
    const { client } = setup(() => ({ body: { itineraries: [], direct: [] } }));
    await expect(client.plan(A, B, T)).rejects.toMatchObject({ msg: { key: "err.motis_no_itinerary", params: { origin: A, destination: B, time: T, minutes: 60 } } });
  });
  it("a `direct` walk alone is a result", async () => {
    const walk = { duration: 600, legs: [{ mode: "WALK", from: { name: "a", lat: 1, lon: 1 }, to: { name: "b", lat: 1, lon: 1.001 }, startTime: T, endTime: T }] };
    const { client } = setup(() => ({ body: { itineraries: [], direct: [walk] } }));
    const [legs] = await client.planLegCandidates(A, B, T);
    expect(legs[0].mode).toBe("pieszo");
  });
  it("rejects a non-object body", async () => {
    const { client } = setup(() => ({ body: "<html>" }));
    await expect(client.plan(A, B, T)).rejects.toBeInstanceOf(MotisError);
  });
});

describe("retry", () => {
  it("retries 5xx with exponential backoff, then succeeds", async () => {
    let n = 0;
    const { client, calls, sleeps } = setup(() => (++n < 3 ? { status: 502 } : { body: PLAN }));
    await client.plan(A, B, T);
    expect(calls.length).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
    expect(client.stats.retries).toBe(2);
  });
  it("honours Retry-After on 429 (capped)", async () => {
    let n = 0;
    const { client, sleeps } = setup(() => (++n < 2 ? { status: 429, headers: { "Retry-After": "7" } } : { body: PLAN }));
    await client.plan(A, B, T);
    expect(sleeps).toEqual([7000]);
    let m = 0;
    const s2 = setup(() => (++m < 2 ? { status: 429, headers: { "Retry-After": "9999" } } : { body: PLAN }));
    await s2.client.plan(A, B, T);
    expect(s2.sleeps).toEqual([30000]);
  });
  it("gives up after maxRetries with err.motis_request", async () => {
    const { client, calls } = setup(() => ({ status: 503 }));
    await expect(client.plan(A, B, T)).rejects.toMatchObject({ msg: { key: "err.motis_request", params: { error: "HTTP 503" } } });
    expect(calls.length).toBe(3);
  });
  it("does not retry 404", async () => {
    const { client, calls } = setup(() => ({ status: 404, body: {} }));
    await expect(client.plan(A, B, T)).rejects.toBeInstanceOf(MotisError);
    expect(calls.length).toBe(1);
  });
  it("network errors are retried and reported", async () => {
    const { client, calls } = setup(() => Promise.reject(new TypeError("Failed to fetch")) as Promise<never>);
    await expect(client.plan(A, B, T)).rejects.toMatchObject({ msg: { params: { error: "Failed to fetch" } } });
    expect(calls.length).toBe(3);
  });
  it("a timeout aborts the request", async () => {
    const calls: number[] = [];
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_res, rej) => {
        calls.push(1);
        init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const client = createTransitousClient({ fetch: hang, timeoutMs: 10, maxRetries: 0 });
    await expect(client.plan(A, B, T)).rejects.toBeInstanceOf(MotisError);
    expect(calls.length).toBe(1);
  });
  it("a caller's AbortSignal cancels without retrying", async () => {
    const ctrl = new AbortController();
    const { client, calls } = setup(() => {
      ctrl.abort();
      return Promise.reject(new DOMException("aborted", "AbortError")) as Promise<never>;
    });
    await expect(client.plan(A, B, T, { signal: ctrl.signal })).rejects.toMatchObject({ msg: { params: { error: "aborted" } } });
    expect(calls.length).toBe(1);
  });
});

describe("geocoding", () => {
  const rows = [
    { lat: 51.2465, lon: 22.5684, name: "Lublin", type: "PLACE", areas: [{ name: "Lubelskie", adminLevel: 4 }, { name: "Polska", adminLevel: 2 }] },
    { lat: 51.2, lon: 22.6, name: "", type: "STOP", id: "s1", country: "PL", category: "rail" },
    { lat: 1, lon: 2, name: "Third" },
  ];
  it("returns suggestions like the oracle and respects the limit", async () => {
    const { client } = setup(() => ({ body: rows }));
    const [first, second] = await client.geocodeSuggestions("Lublin", 2);
    expect(first).toEqual({ lat: 51.2465, lon: 22.5684, name: "Lublin", type: "PLACE", areas: [{ name: "Lubelskie", adminLevel: 4 }, { name: "Polska", adminLevel: 2 }] });
    expect(second).toEqual({ lat: 51.2, lon: 22.6, name: "Lublin", type: "STOP", category: "rail", country: "PL" }); // empty name -> the query
    expect((await client.geocodeSuggestions("Lublin", 5)).length).toBe(3);
  });
  it("empty text sends nothing", async () => {
    const { client, calls } = setup(() => ({ body: rows }));
    expect(await client.geocodeSuggestions("  ")).toEqual([]);
    expect(calls.length).toBe(0);
  });
  it("caches case/whitespace-insensitively and never spends a plan budget", async () => {
    const { client, calls } = setup(() => ({ body: rows }));
    await client.geocodeSuggestions("Lublin");
    await client.geocodeSuggestions("  lublin ");
    expect(calls.length).toBe(1);
    expect(new URL(calls[0]).searchParams.get("text")).toBe("Lublin");
  });
  it("errors are not cached", async () => {
    let n = 0;
    const { client } = setup(() => (++n <= 3 ? { status: 500 } : { body: rows }), { maxRetries: 2 });
    await expect(client.geocodeSuggestions("x")).rejects.toMatchObject({ msg: { key: "err.motis_geocode" } });
    expect((await client.geocodeSuggestions("x")).length).toBe(3);
  });
  it("geocode() returns the first match or err.motis_address_not_found", async () => {
    const { client } = setup(() => ({ body: rows }));
    expect(await client.geocode("Lublin")).toEqual([51.2465, 22.5684, "Lublin"]);
    const empty = setup(() => ({ body: [] }));
    await expect(empty.client.geocode("zzz")).rejects.toMatchObject({ msg: { key: "err.motis_address_not_found" } });
  });
  it("finds the nearest STOP within the radius, or errors", async () => {
    const stops = [
      { lat: 51.1, lon: 17.0, type: "STOP", id: "far" },
      { lat: 51.0990, lon: 17.0365, type: "STOP", id: "near" },
      { lat: 51.0989, lon: 17.0362, type: "PLACE", id: "place" },
    ];
    const { client, calls } = setup(() => ({ body: stops }));
    const ref = { name: "Wrocław Główny", lat: 51.0989, lon: 17.0362 };
    expect(await client.findStopId(ref)).toBe("near");
    expect(await client.findStopId(ref)).toBe("near");
    expect(calls.length).toBe(1);
    await expect(client.findStopId({ name: "Wrocław Główny", lat: 10, lon: 10 })).rejects.toMatchObject({ msg: { key: "err.motis_stop_not_found" } });
  });
  it("reverse geocode returns the first match with areas, cached", async () => {
    const { client, calls } = setup(() => ({ body: [{ name: "x" }, { areas: [{ name: "Lubelskie", adminLevel: 4 }] }] }));
    expect(await client.reverseGeocodeAreas(51.24651, 22.56841)).toEqual([{ name: "Lubelskie", adminLevel: 4 }]);
    await client.reverseGeocodeAreas(51.24654, 22.56844);
    expect(calls.length).toBe(1);
  });
});

describe("base URL safety", () => {
  it("accepts https and http only for localhost; strips trailing slashes", () => {
    expect(validateBaseUrl("https://api.transitous.org/")).toBe("https://api.transitous.org");
    expect(validateBaseUrl("http://localhost:8080")).toBe("http://localhost:8080");
    expect(validateBaseUrl("https://example.org/motis//")).toBe("https://example.org/motis");
  });
  it("rejects plain http elsewhere, credentials, other schemes and junk", () => {
    for (const bad of ["http://api.transitous.org", "https://user:pw@api.transitous.org", "ftp://x", "javascript:alert(1)", "not a url", ""]) {
      expect(() => validateBaseUrl(bad), bad).toThrow(MotisError);
    }
  });
  it("sends no cookies (credentials omitted) and only an Accept header", async () => {
    let init: RequestInit | undefined;
    const f = (async (_: unknown, i?: RequestInit) => {
      init = i;
      return { status: 200, headers: { get: () => null }, json: async () => PLAN } as unknown as Response;
    }) as typeof fetch;
    await createTransitousClient({ fetch: f }).plan(A, B, T);
    expect(init?.headers).toEqual({ Accept: "application/json" });
    expect(init?.credentials).toBe("omit");
  });
});
