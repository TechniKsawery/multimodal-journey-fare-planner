// Behaviour of the variants/search with the real Transitous client on a fake fetch: query budget, fast vs extended mode,
// error handling. (The parity with the oracle is in variants.golden.test.ts.)
import { describe, expect, it } from "vitest";
import fixture from "../../tests/fixtures/motis_kd_wroclaw_klodzko.json";
import { BudgetExceededError, MotisError } from "../src/routing/errors";
import { search } from "../src/routing/search";
import { createTransitousClient, fastBudget, FAST_QUERY_ITINERARIES, QueryBudget } from "../src/routing/transitousClient";
import { generateVariants, makeRouteRequest, type AlternativeStop } from "../src/routing/variants";

const day = "2026-10-20"; // the day of the fixture (Wrocław -> Kłodzko, 08:00Z)

function setup(handler: (url: URL) => unknown = () => ({ itineraries: [fixture], direct: [] })) {
  const calls: URL[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith("/geocode")) {
      return { status: 200, headers: { get: () => null }, json: async () => [{ type: "STOP", id: "stop_1", name: "Poznań Główny", lat: 52.4019, lon: 16.9125 }] } as unknown as Response;
    }
    return { status: 200, headers: { get: () => null }, json: async () => handler(url) } as unknown as Response;
  }) as typeof fetch;
  const client = createTransitousClient({ fetch: fetchFn, now: () => 0, sleep: async () => {} });
  return { client, calls };
}

// the fixture runs Wrocław -> Kłodzko on `day`; the request is for that day, coordinates avoid the detour filter
const request = (over = {}) => makeRouteRequest({ origin_stop_id: "51.1,17.04", destination_stop_id: "50.43,16.65", origin_label: "A", destination_label: "B", date: day, departure_time: "00:00:00", ...over });
const poznan: AlternativeStop = { label: "Poznań Główny", stop_id: { name: "Poznań Główny", lat: 52.4019, lon: 16.9125 } };

describe("variants on the Transitous client", () => {
  it("fast mode makes ONE query for the main variants and skips the via hubs", async () => {
    const { client, calls } = setup();
    const budget = fastBudget();
    const { built, skipped } = await generateVariants(client, request(), { mode: "fast", budget, viaHubStops: [poznan] });
    expect(built.length).toBeGreaterThan(0);
    expect(skipped).toEqual([]);
    const plans = calls.filter((c) => c.pathname.endsWith("/plan"));
    expect(plans.length).toBe(1);
    expect(plans[0].searchParams.get("numItineraries")).toBe(String(FAST_QUERY_ITINERARIES));
    expect(budget.spent).toBe(1);
  });

  it("a via-hub variant that runs out of budget is skipped with the budget reason, the main variants stay", async () => {
    const { client } = setup();
    const budget = new QueryBudget(1); // only the main query fits
    // origin and destination near the via hub, so the detour filter lets the variant through
    const near = request({ origin_stop_id: "52.41,16.93", destination_stop_id: "52.5,17.1" });
    const { built, skipped } = await generateVariants(client, near, { mode: "extended", budget, viaHubStops: [poznan] });
    expect(built.length).toBeGreaterThan(0);
    expect(skipped.length).toBe(1);
    const reason = skipped[0].reason as { key: string };
    expect(reason.key).toBe("err.transitous_budget");
  });

  it("a failing main query becomes a skipped variant, not an exception", async () => {
    const { client } = setup(() => ({ itineraries: [], direct: [] }));
    const { built, skipped } = await generateVariants(client, request(), { mode: "fast", budget: fastBudget() });
    expect(built).toEqual([]);
    expect((skipped[0].variant_name as { key: string }).key).toBe("variant.rail_only_plain");
    expect((skipped[0].reason as { key: string }).key).toBe("err.motis_no_itinerary");
  });

  it("an error that is not a MotisError (a bug, an abort) is not swallowed", async () => {
    const boom = { async plan() { throw new TypeError("boom"); }, async findStopId() { return "x"; } };
    await expect(generateVariants(boom, request(), { mode: "fast" })).rejects.toBeInstanceOf(TypeError);
    const aborted = { async plan() { throw new DOMException("aborted", "AbortError"); }, async findStopId() { return "x"; } };
    await expect(generateVariants(aborted, request(), { mode: "fast" })).rejects.toBeInstanceOf(DOMException);
  });

  it("search() returns recommendations for a feasible result and {} for an empty one", async () => {
    const ok = await search(setup().client, request(), { budget: fastBudget() });
    expect(Object.keys(ok.recommendations).length).toBeGreaterThan(0);
    const empty = await search(setup(() => ({ itineraries: [], direct: [] })).client, request(), { budget: fastBudget() });
    expect(empty.built).toEqual([]);
    expect(empty.recommendations).toEqual({});
  });

  it("errors from the client keep their reason (MotisError / BudgetExceededError)", () => {
    expect(new BudgetExceededError(2)).toBeInstanceOf(MotisError);
  });
});
