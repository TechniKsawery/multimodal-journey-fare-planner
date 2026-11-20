import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  QueryBudget,
  TransitousClient,
  buildGeocodeUrl,
  buildPlanUrl,
  placeArg,
} from "./transitous";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("QueryBudget", () => {
  it("allows exactly `limit` requests per day and resets the next day", () => {
    let day = "2026-11-20T10:00:00Z";
    const b = new QueryBudget(2, mem(), () => new Date(day));
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    expect(b.remaining()).toBe(0);
    day = "2026-11-21T00:00:01Z";
    expect(b.remaining()).toBe(2);
  });
  it("works without storage", () => {
    const b = new QueryBudget(1, null);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });
});

describe("urls", () => {
  it("builds the plan url", () => {
    const u = new URL(buildPlanUrl({ from: "a", to: "b", time: "2026-12-01T08:00:00Z" }));
    expect(u.origin + u.pathname).toBe("https://api.transitous.org/api/v6/plan");
    expect(u.searchParams.get("fromPlace")).toBe("a");
    expect(u.searchParams.get("numItineraries")).toBe("5");
  });
  it("builds the geocode url", () => {
    expect(buildGeocodeUrl("Lublin Główny", "pl")).toContain("text=Lublin+G%C5%82%C3%B3wny&language=pl");
  });
  it("uses stop id for stops and coordinates otherwise", () => {
    expect(placeArg({ type: "STOP", id: "x_1", name: "n", lat: 1, lon: 2 })).toBe("x_1");
    expect(placeArg({ type: "ADDRESS", name: "n", lat: 1.5, lon: 2.5 })).toBe("1.5,2.5");
  });
});

describe("TransitousClient", () => {
  const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

  it("caches identical plan requests and counts them once", async () => {
    let calls = 0;
    const c = new TransitousClient({
      fetchImpl: (async () => (calls++, new Response('{"itineraries":[]}'))) as typeof fetch,
      budget: new QueryBudget(5, null),
    });
    const q = { from: "a", to: "b", time: "t" };
    await c.plan(q);
    await c.plan(q);
    expect(calls).toBe(1);
    expect(c.budget.used()).toBe(1);
  });

  it("refuses to call the API when the budget is spent", async () => {
    const c = new TransitousClient({
      fetchImpl: ok({ itineraries: [] }) as unknown as typeof fetch,
      budget: new QueryBudget(0, null),
    });
    await expect(c.plan({ from: "a", to: "b", time: "t" })).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("reports 429 as a busy service", async () => {
    const c = new TransitousClient({
      fetchImpl: (async () => new Response("", { status: 429 })) as typeof fetch,
      budget: new QueryBudget(5, null),
    });
    await expect(c.plan({ from: "a", to: "b", time: "t" })).rejects.toMatchObject({ status: 429 });
  });
});

describe("geocode", () => {
  it("has its own budget, caches and ignores malformed rows", async () => {
    let calls = 0;
    const body = [{ type: "STOP", name: "Lublin Główny", lat: 51.2, lon: 22.5 }, { name: "bad" }, null];
    const c = new TransitousClient({
      fetchImpl: (async () => (calls++, new Response(JSON.stringify(body)))) as typeof fetch,
      budget: new QueryBudget(5, null),
      geocodeBudget: new QueryBudget(1, null),
    });
    expect(await c.geocode("lubl", "pl")).toHaveLength(1);
    expect(await c.geocode("lubl", "pl")).toHaveLength(1); // cached, not counted
    expect(calls).toBe(1);
    await expect(c.geocode("berlin", "pl")).rejects.toBeInstanceOf(BudgetExceededError);
    expect(c.budget.used()).toBe(0);
  });
  it("turns a network failure and a non-array body into TransitousError", async () => {
    const down = new TransitousClient({
      fetchImpl: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch,
      geocodeBudget: new QueryBudget(5, null),
    });
    await expect(down.geocode("x1", "pl")).rejects.toMatchObject({ name: "TransitousError" });
    const odd = new TransitousClient({
      fetchImpl: (async () => new Response('{"a":1}')) as typeof fetch,
      geocodeBudget: new QueryBudget(5, null),
    });
    await expect(odd.geocode("x2", "pl")).rejects.toMatchObject({ name: "TransitousError" });
  });
});
