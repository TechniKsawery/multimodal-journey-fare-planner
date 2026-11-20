// Network side of the search: the Transitous client from core/ (cache, retries, per-search budget,
// https only) plus a per-day cap kept in localStorage so one browser cannot hammer the shared
// service (policy: stay far below 720 /plan a day). Only requests that really hit the network are
// counted, cached answers are free.
import { allItineraries } from "../../../core/src/routing/motis";
import {
  FAST_QUERY_ITINERARIES,
  createTransitousClient,
  fastBudget,
  type GeocodeSuggestion,
} from "../../../core/src/routing/transitousClient";
import { MotisError } from "../../../core/src/routing/errors";
import { BudgetExceededError, DEFAULT_DAILY_GEOCODE_BUDGET, DEFAULT_DAILY_PLAN_BUDGET, QueryBudget } from "../transitous";

export type { GeocodeSuggestion };

export const client = createTransitousClient();
export const planBudget = new QueryBudget(DEFAULT_DAILY_PLAN_BUDGET);
const geocodeBudget = new QueryBudget(DEFAULT_DAILY_GEOCODE_BUDGET, undefined, undefined, "geocode");

/** Runs `fn`, then charges the daily budget for the network requests it actually sent. */
async function metered<T>(budget: QueryBudget, fn: () => Promise<T>): Promise<T> {
  if (budget.remaining() <= 0) throw new BudgetExceededError();
  const before = client.stats.requests;
  try {
    return await fn();
  } finally {
    for (let i = client.stats.requests - before; i > 0; i--) budget.take();
  }
}

export const suggest = (text: string, signal?: AbortSignal): Promise<GeocodeSuggestion[]> =>
  metered(geocodeBudget, () => client.geocodeSuggestions(text, 7, signal));

/** Raw Transitous itineraries for one search (empty array = the service found nothing). */
export async function searchRoutes(
  from: GeocodeSuggestion,
  to: GeocodeSuggestion,
  whenIso: string,
  signal?: AbortSignal,
): Promise<unknown[]> {
  try {
    const payload = await metered(planBudget, () =>
      client.plan(`${from.lat},${from.lon}`, `${to.lat},${to.lon}`, whenIso, {
        numItineraries: FAST_QUERY_ITINERARIES,
        maxTransfers: 5,
        budget: fastBudget(),
        signal,
      }),
    );
    return allItineraries(payload).slice(0, 20);
  } catch (e) {
    if (e instanceof MotisError && e.msg.key === "err.motis_no_itinerary") return [];
    throw e;
  }
}
