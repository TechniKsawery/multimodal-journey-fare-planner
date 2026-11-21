// Port of routing/search_service.py: one entry point for a search — the variants plus the recommendations.
import type { Itinerary, OtherDayVariant, SkippedVariant } from "./model";
import { VIA_HUB_STOPS } from "./demoRoute";
import { pickRecommendations } from "./scoring";
import { generateVariants, type RouteRequest, type RoutingClient, type VariantOptions } from "./variants";

export interface SearchResult {
  request: RouteRequest;
  built: Itinerary[];
  skipped: SkippedVariant[];
  recommendations: Record<string, Itinerary>;
  /** "Nearest connections on another day": only for an empty result, when the service had connections only on other days. */
  other_day: OtherDayVariant[];
}

/**
 * Variants for `request` plus the recommendations (`{}` when nothing feasible was built, so the caller needs no try/catch).
 * "fast" mode (default) makes only the main query; "extended" also tries the Poznań via-hub variant. The destination
 * alternatives are NOT used (see demoRoute.ts::ALTERNATIVE_DESTINATION_STOPS).
 */
export async function search(client: RoutingClient, request: RouteRequest, opts: VariantOptions = {}): Promise<SearchResult> {
  const otherDay: OtherDayVariant[] = [];
  const { built, skipped } = await generateVariants(client, request, {
    mode: opts.mode ?? "fast",
    budget: opts.budget,
    signal: opts.signal,
    viaHubStops: [...VIA_HUB_STOPS],
    otherDayOut: otherDay,
  });
  return { request, built, skipped, recommendations: built.length > 0 ? pickRecommendations(built) : {}, other_day: otherDay };
}
