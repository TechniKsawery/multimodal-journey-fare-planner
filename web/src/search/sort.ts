import type { Itinerary } from '../types';

/** 0 = fully priced, 1 = partial price (sum covers only some legs), 2 = no known price. */
export function priceGroup(it: Pick<Itinerary, 'partial' | 'noPrice'>): 0 | 1 | 2 {
  if (it.noPrice) return 2;
  return it.partial ? 1 : 0;
}

/**
 * Price order, explainable in one sentence: fully priced routes first (cheapest first), then routes with a
 * partial price (their sums are NOT comparable with complete ones, so they never mix in), then routes without
 * any price. Inside a group: total price, then duration. Group and price are separate keys on purpose.
 */
export function comparePrice(
  a: Pick<Itinerary, 'partial' | 'noPrice' | 'totalPln' | 'durationMin'>,
  b: Pick<Itinerary, 'partial' | 'noPrice' | 'totalPln' | 'durationMin'>,
): number {
  const g = priceGroup(a) - priceGroup(b);
  if (g !== 0) return g;
  if (priceGroup(a) === 2) return a.durationMin - b.durationMin;
  return a.totalPln - b.totalPln || a.durationMin - b.durationMin;
}
