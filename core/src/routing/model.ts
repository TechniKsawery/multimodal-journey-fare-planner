// Port of routing/model.py: legs, priced legs and itinerary variants.
// Plain data + functions (instead of Python properties) so the objects survive structuredClone/JSON
// and can cross a Web Worker boundary. Datetimes are `Date` instants (the oracle uses aware datetimes).
import type { Carrier } from "../fares/model";
import { msg, type Msg, type Text } from "../i18n/msg";
import { truthy } from "../pyCompat";
import {
  EXTRA_CARRIER_PENALTY_MIN,
  EXTRA_CARRIER_PENALTY_PLN,
  RISKY_TRANSFER_PENALTY_MIN,
  RISKY_TRANSFER_PENALTY_PLN,
  VALUE_OF_TIME_PLN_PER_HOUR,
} from "./scoringConfig";

export const LegMode = { RAIL: "kolej", FLIGHT: "lot", BUS: "autobus", WALK: "pieszo" } as const;
export type LegMode = (typeof LegMode)[keyof typeof LegMode];

export interface Leg {
  mode: LegMode;
  origin_name: string;
  destination_name: string;
  depart: Date;
  arrive: Date;
  carrier_name: string; // e.g. "PKP Intercity", "DB Fernverkehr AG", "Ryanair"
  distance_km: number | null;
  /** Whether the transfer at the start of this leg needs a walk (platform/station/terminal change). */
  requires_walk: boolean;
  extra: Record<string, unknown>; // e.g. IATA codes for flights, MOTIS stop ids
}

export function makeLeg(
  init: Pick<Leg, "mode" | "origin_name" | "destination_name" | "depart" | "arrive"> & Partial<Leg>,
): Leg {
  return { carrier_name: "", distance_km: null, requires_walk: true, extra: {}, ...init };
}

export const legDurationMin = (leg: Leg): number => (leg.arrive.getTime() - leg.depart.getTime()) / 60000;

export interface PricedLeg {
  leg: Leg;
  amount: number;
  currency: string;
  price_type: string; // "szacunek" or "oficjalna_taryfa"
  notes: string;
  breakdown: Record<string, unknown>; // passed 1:1 from PriceEstimate.breakdown
  carrier: Carrier | null;
}

export function makePricedLeg(
  init: Pick<PricedLeg, "leg" | "amount" | "currency" | "price_type"> & Partial<PricedLeg>,
): PricedLeg {
  return { notes: "", breakdown: {}, carrier: null, ...init };
}

/** False when the amount is unknown (breakdown.cena_nieznana): amount 0 is then NO price, not a zero price. */
export const priceKnown = (pl: PricedLeg): boolean => !truthy(pl.breakdown["cena_nieznana"]);

/**
 * Whether the price is confirmed. An explicit breakdown.price_verified flag always wins; without
 * one, an "szacunek" price is NOT confirmed (an API snapshot, a distance band, a flight quote).
 */
export function priceVerified(pl: PricedLeg): boolean {
  if (!priceKnown(pl)) return false;
  const flag = pl.breakdown["price_verified"];
  if (typeof flag === "boolean") return flag;
  return pl.price_type !== "szacunek";
}

export function unverifiedLabel(pl: PricedLeg): string {
  if (priceVerified(pl)) return "";
  if (truthy(pl.breakdown["cena_nieznana"])) return "cena nieznana (odcinek nie wliczony w sumę)";
  if (truthy(pl.breakdown["wartosc_zastepcza"])) return "cena niepotwierdzona (wartość zastępcza, nie z cennika)";
  return "cena niepotwierdzona";
}

export interface TransferWarning {
  after_leg_index: number; // index of the leg BEFORE the transfer (between legs[i] and legs[i+1])
  gap_minutes: number;
  minimum_required_minutes: number;
  reason: Msg;
  infeasible: boolean; // below the absolute feasibility minimum (nobody can make it)
}

export interface Itinerary {
  variant_name: Text; // a Msg (translated by the UI) or a plain string
  legs: PricedLeg[];
  total_price_pln: number;
  total_duration_min: number;
  num_transfers: number;
  transfer_warnings: TransferWarning[];
  total_price_pln_high: number | null; // upper bound when a leg has a price range (PKP SPI)
  is_safe_fallback: boolean;
}

export function makeItinerary(
  init: Pick<Itinerary, "variant_name" | "legs" | "total_price_pln" | "total_duration_min" | "num_transfers"> &
    Partial<Itinerary>,
): Itinerary {
  return { transfer_warnings: [], total_price_pln_high: null, is_safe_fallback: false, ...init };
}

export const itineraryPriceVerified = (i: Itinerary): boolean => i.legs.every(priceVerified);

/** "pelna" | "czesciowa" | "brak": a missing amount is never guessed. */
export function priceStatus(i: Itinerary): "pelna" | "czesciowa" | "brak" {
  if (i.legs.every(priceKnown)) return "pelna";
  const hasKnown = i.legs.some((pl) => priceKnown(pl) && pl.leg.mode !== LegMode.WALK);
  return hasKnown ? "czesciowa" : "brak";
}

export const isInfeasible = (i: Itinerary): boolean => i.transfer_warnings.some((w) => w.infeasible);
export const isRisky = (i: Itinerary): boolean => i.transfer_warnings.some((w) => !w.infeasible);
export const numRiskyTransfers = (i: Itinerary): number => i.transfer_warnings.filter((w) => !w.infeasible).length;

export function pricePerHour(i: Itinerary): number {
  const hours = i.total_duration_min / 60;
  return hours > 0 ? i.total_price_pln / hours : Infinity;
}

/** Number of distinct carriers (each is a separate ticket), walking legs excluded. */
export function numCarriers(i: Itinerary): number {
  return new Set(i.legs.filter((pl) => pl.leg.mode !== LegMode.WALK).map((pl) => pl.leg.carrier_name || pl.leg.mode)).size;
}

/** Generalised cost for "best price/time" (PLN, lower is better). */
export function valueScore(i: Itinerary): number {
  const extraCarriers = Math.max(numCarriers(i) - 1, 0);
  const risky = numRiskyTransfers(i);
  const price = i.total_price_pln + risky * RISKY_TRANSFER_PENALTY_PLN + extraCarriers * EXTRA_CARRIER_PENALTY_PLN;
  const minutes = i.total_duration_min + risky * RISKY_TRANSFER_PENALTY_MIN + extraCarriers * EXTRA_CARRIER_PENALTY_MIN;
  return price + (minutes / 60) * VALUE_OF_TIME_PLN_PER_HOUR;
}

export interface SkippedVariant {
  variant_name: Text;
  reason: Text;
}

export const OTHER_DAY_SECTION_TITLE = "Najbliższe połączenia w innym dniu";

function daysPhrase(daysOffset: number): Msg {
  const n = Math.abs(daysOffset);
  const when = daysOffset > 0 ? "later" : "earlier";
  return msg(`other_day.${when}_${n === 1 ? "one" : "many"}`, { n });
}

/** A connection on a DIFFERENT day than requested — only a hint, never part of the main ranking. */
export interface OtherDayVariant {
  itinerary: Itinerary;
  date: string; // YYYY-MM-DD, local departure day
  requested_date: string;
  days_offset: number; // date - requested_date in days (negative = earlier)
  label: Msg;
}

export function makeOtherDayVariant(
  init: Pick<OtherDayVariant, "itinerary" | "date" | "requested_date" | "days_offset">,
): OtherDayVariant {
  return {
    ...init,
    label: msg("other_day.label", { date: init.date, phrase: daysPhrase(init.days_offset), requested: init.requested_date }),
  };
}
