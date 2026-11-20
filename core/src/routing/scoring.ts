// Port of routing/scoring.py: aggregating legs into an Itinerary and picking recommendations.
//
// "Cheapest" first compares variants with a CONFIRMED price: a variant with a leg that has no tariff
// (a PLN/km estimate or a placeholder) does not beat a confirmed one even if its sum is nominally
// lower — that sum is not a price, only a rough estimate. If no variant is confirmed, the nominally
// cheapest wins and the UI marks it as unconfirmed.
import { toPln } from "../common/currency";
import { msg, type Msg } from "../i18n/msg";
import { ValueError, formatFixed, round2, truthy } from "../pyCompat";
import {
  LegMode,
  isInfeasible,
  isRisky,
  itineraryPriceVerified,
  numRiskyTransfers,
  priceKnown,
  priceStatus,
  valueScore,
  type Itinerary,
  type PricedLeg,
} from "./model";
import { checkAllTransfers } from "./transfers";

export const RECOMMENDATION_LABELS: Readonly<Record<string, string>> = {
  najtansza: "Najtańsza",
  najszybsza: "Najszybsza",
  najmniej_przesiadek: "Najmniej przesiadek",
  najlepszy_stosunek_ceny_do_czasu: "Najlepszy stosunek cena/czas",
  najlepszy_kompromis: "Najlepszy kompromis",
  najszybsza_z_ulgami: "Najszybsza (z Twoimi ulgami)",
  najszybsza_bezpieczna: "Najszybsza bezpieczna",
  najtansza_bezpieczna: "Najtańsza bezpieczna",
  najlepszy_kompromis_bezpieczny: "Najlepszy kompromis (bezpieczny)",
  najszybsza_z_ulgami_bezpieczna: "Najszybsza z ulgami (bezpieczna)",
  najmniej_przesiadek_bezpieczna: "Najmniej przesiadek (bezpieczna)",
};

export const SAFE_CATEGORY_KEYS = [
  "najszybsza_bezpieczna",
  "najtansza_bezpieczna",
  "najlepszy_kompromis_bezpieczny",
  "najszybsza_z_ulgami_bezpieczna",
  "najmniej_przesiadek_bezpieczna",
] as const;

// Categories decided by price: an unconfirmed-price variant loses in them to a confirmed one.
export const PRICE_RANKED_KEYS = ["najtansza", "najtansza_bezpieczna"] as const;

// Categories shown immediately in the UI (the rest sit under "show more").
export const TOP_CATEGORY_KEYS = ["najtansza", "najszybsza", "najlepszy_kompromis", "najszybsza_z_ulgami"] as const;

// "Close to the fastest" threshold: 10% of the fastest variant's time, but at least 10 minutes.
export const FASTEST_TOLERANCE_FRACTION = 0.1;
export const FASTEST_TOLERANCE_MIN_MINUTES = 10;

type SortKey = number | boolean | readonly (number | boolean)[];

/** Python comparison of numbers/bools/tuples of them. */
function compareKeys(a: SortKey, b: SortKey): number {
  const ta = Array.isArray(a) ? a : [a];
  const tb = Array.isArray(b) ? b : [b];
  for (let k = 0; k < Math.min(ta.length, tb.length); k++) {
    const x = Number(ta[k]);
    const y = Number(tb[k]);
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return ta.length - tb.length;
}

/** Python `min(items, key=...)`: the FIRST item with the smallest key wins ties. */
function minBy<T>(items: readonly T[], key: (item: T) => SortKey): T {
  if (items.length === 0) throw new ValueError("min() iterable argument is empty");
  let best = items[0];
  let bestKey = key(best);
  for (let k = 1; k < items.length; k++) {
    const kk = key(items[k]);
    if (compareKeys(kk, bestKey) < 0) {
      best = items[k];
      bestKey = kk;
    }
  }
  return best;
}

/** key() for min(): mean of the normalised (0..1) price and time positions RELATIVE to `pool`. */
function compromiseKey(pool: Itinerary[]): (i: Itinerary) => number {
  const prices = pool.map((i) => i.total_price_pln);
  const durations = pool.map((i) => i.total_duration_min);
  const pLo = Math.min(...prices);
  const pHi = Math.max(...prices);
  const dLo = Math.min(...durations);
  const dHi = Math.max(...durations);
  const norm = (value: number, lo: number, hi: number) => (hi <= lo ? 0.0 : (value - lo) / (hi - lo));
  return (i) => (norm(i.total_price_pln, pLo, pHi) + norm(i.total_duration_min, dLo, dHi)) / 2;
}

function fastestWithinTolerance(pool: Itinerary[], key: (i: Itinerary) => SortKey = (i) => i.total_price_pln): Itinerary {
  const fastest = Math.min(...pool.map((i) => i.total_duration_min));
  const tolerance = Math.max(fastest * FASTEST_TOLERANCE_FRACTION, FASTEST_TOLERANCE_MIN_MINUTES);
  return minBy(
    pool.filter((i) => i.total_duration_min <= fastest + tolerance),
    key,
  );
}

/** Feasible variants with an unconfirmed price that are nominally cheaper than `chosen` (cheapest first). */
export function cheaperUnverified(itineraries: Itinerary[], chosen: Itinerary): Itinerary[] {
  return itineraries
    .filter((i) => !isInfeasible(i) && !itineraryPriceVerified(i) && i.total_price_pln < chosen.total_price_pln)
    .sort((a, b) => a.total_price_pln - b.total_price_pln);
}

/** Note shown under a PRICE_RANKED category (an i18n message), or null when there is nothing to add. */
export function priceRankingNote(key: string, chosen: Itinerary, itineraries: Itinerary[]): Msg | null {
  if (!(PRICE_RANKED_KEYS as readonly string[]).includes(key)) return null;
  if (!itineraryPriceVerified(chosen)) return msg("rank.unverified_only");
  if (key !== "najtansza") return null;
  const skipped = cheaperUnverified(itineraries, chosen);
  if (skipped.length === 0) return null;
  const cheapest = skipped[0];
  return msg("rank.skipped_cheaper", {
    n: skipped.length,
    name: cheapest.variant_name,
    price: formatFixed(cheapest.total_price_pln, 2),
  });
}

const usable = (pl: PricedLeg): boolean => priceKnown(pl) && !truthy(pl.breakdown["wartosc_zastepcza"]);

export function buildItinerary(variantName: string, pricedLegs: PricedLeg[]): Itinerary {
  if (pricedLegs.length === 0) throw new ValueError(`wariant '${variantName}': brak odcinków`);

  const totalPricePln = pricedLegs.filter(usable).reduce((sum, pl) => sum + toPln(pl.amount, pl.currency), 0);
  const first = pricedLegs[0].leg;
  const last = pricedLegs[pricedLegs.length - 1].leg;
  const totalDurationMin = (last.arrive.getTime() - first.depart.getTime()) / 60000;
  const hasRange = pricedLegs.some((pl) => Object.hasOwn(pl.breakdown, "zakres_cen"));
  const high = hasRange
    ? round2(
        pricedLegs.filter(usable).reduce((sum, pl) => {
          const range = pl.breakdown["zakres_cen"] as { do: number; waluta: string } | undefined;
          return sum + (range !== undefined ? toPln(range.do, range.waluta) : toPln(pl.amount, pl.currency));
        }, 0),
      )
    : null;

  return {
    variant_name: variantName,
    legs: pricedLegs,
    total_price_pln: round2(totalPricePln),
    total_price_pln_high: high,
    total_duration_min: totalDurationMin,
    num_transfers: Math.max(pricedLegs.filter((pl) => pl.leg.mode !== LegMode.WALK).length - 1, 0),
    transfer_warnings: checkAllTransfers(pricedLegs.map((pl) => pl.leg)),
    is_safe_fallback: false,
  };
}

const hasPlaceholder = (i: Itinerary): boolean => i.legs.some((pl) => truthy(pl.breakdown["wartosc_zastepcza"]));

/**
 * Picks recommendations. One variant may win several categories (not a bug). "Safe" = no risky
 * transfer; when no variant is safe, the least risky one is used and flagged via `is_safe_fallback`.
 */
export function pickRecommendations(all: Itinerary[]): Record<string, Itinerary> {
  const itineraries = all.filter((i) => !isInfeasible(i)); // never recommend infeasible ones
  if (itineraries.length === 0) throw new ValueError("brak wariantów do wyboru rekomendacji");

  const safe = itineraries.filter((i) => !isRisky(i));
  const safePool = safe.length > 0 ? safe : itineraries;
  for (const i of itineraries) i.is_safe_fallback = safe.length === 0;

  const compromise = compromiseKey(itineraries);
  const safeCompromise = compromiseKey(safePool);
  const notFullOrPlaceholder = (i: Itinerary) => priceStatus(i) !== "pelna" || hasPlaceholder(i);

  return {
    najtansza: minBy(itineraries, (i) => [notFullOrPlaceholder(i), !itineraryPriceVerified(i), i.total_price_pln]),
    najszybsza: minBy(itineraries, (i) => i.total_duration_min),
    najmniej_przesiadek: minBy(itineraries, (i) => [i.num_transfers, i.total_duration_min, i.total_price_pln]),
    najlepszy_stosunek_ceny_do_czasu: minBy(itineraries, valueScore),
    najlepszy_kompromis: minBy(itineraries, compromise),
    najszybsza_z_ulgami: fastestWithinTolerance(itineraries),
    najszybsza_bezpieczna: minBy(safePool, (i) => [numRiskyTransfers(i), i.total_duration_min]),
    najtansza_bezpieczna: minBy(safePool, (i) => [
      numRiskyTransfers(i),
      notFullOrPlaceholder(i),
      !itineraryPriceVerified(i),
      i.total_price_pln,
    ]),
    najlepszy_kompromis_bezpieczny: minBy(safePool, (i) => [numRiskyTransfers(i), safeCompromise(i)]),
    najmniej_przesiadek_bezpieczna: minBy(safePool, (i) => [
      numRiskyTransfers(i),
      i.num_transfers,
      i.total_duration_min,
      i.total_price_pln,
    ]),
    najszybsza_z_ulgami_bezpieczna: fastestWithinTolerance(safePool, (i) => [numRiskyTransfers(i), i.total_price_pln]),
  };
}

