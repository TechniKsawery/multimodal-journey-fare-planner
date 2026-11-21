// Port of routing/card_suggestions.py: BahnCard suggestion for one concrete itinerary.
// Links core/src/fares/cards.ts with the DB legs of the itinerary so the UI can show "buy the card, save X".
import { Carrier } from "../fares/model";
import { suggestBahncardForTotalPrice, type CardSuggestion } from "../fares/cards";
import { flexpreisUpperBound } from "../fares/db";
import { round2 } from "../pyCompat";
import { LegMode, type Itinerary, type PricedLeg } from "./model";
import { inferRailCarrier, isCrossBorderPlDe } from "./pricing";

/**
 * DB rail legs of the itinerary. PL<->DE cross-border legs are excluded: they have their OWN (partial)
 * BahnCard rules already included in the price (fares/international), even when the agency reads like DB Fernverkehr.
 */
function dbLegs(itinerary: Itinerary): PricedLeg[] {
  return itinerary.legs.filter(
    (pl) => pl.leg.mode === LegMode.RAIL && inferRailCarrier(pl.leg.carrier_name) === Carrier.DB && !isCrossBorderPlDe(pl.leg),
  );
}

/** Sum of distances of the DB legs (0 when there is none). Only a "does it contain DB" signal, not a price basis. */
export function dbDistanceKm(itinerary: Itinerary): number {
  return dbLegs(itinerary).reduce((sum, pl) => sum + (pl.leg.distance_km ?? 0), 0);
}

/** Sum of the Flexpreis (no card) of the INDIVIDUAL DB tickets, each from its own distance band. */
export function dbFlexpreisUpperBoundTotal(itinerary: Itinerary): number {
  return round2(
    dbLegs(itinerary)
      .filter((pl) => pl.leg.distance_km !== null && pl.leg.distance_km > 0)
      .reduce((sum, pl) => sum + flexpreisUpperBound(pl.leg.distance_km as number), 0),
  );
}

/**
 * BahnCard suggestions for the DB legs of this itinerary. Empty when there is no DB Fernverkehr leg
 * or when the user already owns an equal or better card. `referenceDate` (ISO date) pins the day the card
 * price is computed for (promotions have date windows); default today.
 */
export function suggestBahncardForItinerary(
  itinerary: Itinerary,
  age: number | null = null,
  journeysPerYear = 2,
  existingBahncard: string | null = null,
  referenceDate: string | null = null,
): CardSuggestion[] {
  const total = dbFlexpreisUpperBoundTotal(itinerary);
  if (total <= 0) return [];
  return suggestBahncardForTotalPrice(total, journeysPerYear, age, referenceDate, existingBahncard);
}
