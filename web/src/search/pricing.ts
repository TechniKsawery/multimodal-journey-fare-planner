// Adapter between a routed leg and the fare calculators in core/.
//
// Policy ("never guess a price"): a leg gets an amount ONLY when a calculator from core/ may be
// applied with certainty. Everything else becomes an explicit "price unconfirmed" leg that is left
// out of the total (breakdown.cena_nieznana), so the UI shows a partial sum instead of a made-up one.
// The generic PLN/km fallbacks of the Python oracle are intentionally NOT used here.
//
// Covered today: PKP Intercity TLK/IC inside Poland (official band table, student/pupil relief)
// and DB Fernverkehr inside Germany (Flexpreis model x BahnCard). Local/regional tariffs, border
// crossing legs, FlixBus and PKP EIC/EIP wait for the geo/pricing part of the core/ port.
// Calculators are imported one by one (not via fares/calculator dispatch) so the bundle only
// carries the tariff tables that are actually used.
import { estimate as estimateDb } from "../../../core/src/fares/db";
import { estimate as estimatePkp } from "../../../core/src/fares/pkp";
import { defaultDiscountsForAge } from "../../../core/src/fares/ageDefaults";
import { Carrier, defaultProfile, makeSegment, type DiscountProfile } from "../../../core/src/fares/model";
import { LegMode, makePricedLeg, type Leg, type PricedLeg } from "../../../core/src/routing/model";
import type { Profile } from "../types";
import { countryOf, haversineKm } from "./geo";

export type UnconfirmedReason =
  | "crossBorder"
  | "premiumTrain"
  | "unknownCategory"
  | "flixbus"
  | "local"
  | "otherCarrier"
  | "calcError"
  | "noCoords";

/** UI-facing facts about how a leg was priced. Lives in breakdown.ui so it survives core/ scoring. */
export interface PriceMeta {
  status: "official" | "estimate" | "unconfirmed";
  source?: string;
  sourceUrl?: string;
  verified?: string;
  reason?: UnconfirmedReason | "noVerifiedDate" | "dbModel";
}

export const PKP_STUDENT_CODE = "student_do_26_lat_doktorant_do_35_lat";
export const PKP_PUPIL_CODE = "dzieci_mlodziez_szkolna_do_24_lat";
const DB_SOURCE_URL = "https://www.bahn.de/faq/pk/angebot/flexpreis";

/** UI profile -> core discount profile. Only reliefs that are certain are switched on. */
export function toDiscountProfile(p: Profile): DiscountProfile {
  const age = Number.isFinite(p.age) ? p.age : null;
  const out: DiscountProfile = { ...defaultProfile(), ...defaultDiscountsForAge(age), age };
  out.bahncard = p.bahncard === 'none' ? null : p.bahncard;
  if (p.idCountry === 'de' && p.status !== 'none') {
    // A German ID is not an accepted basis for the Polish statutory relief (not verified) -> none.
    out.legitymacja_zagraniczna = true;
    out.pkp_ulga_kod = 'brak';
  } else if (p.status === 'student') {
    out.pkp_ulga_kod = age !== null && age <= 26 ? PKP_STUDENT_CODE : 'brak';
  } else if (p.status === 'pupil') {
    out.pkp_ulga_kod = age !== null && age <= 24 ? PKP_PUPIL_CODE : 'brak';
  }
  return out;
}

function matchesWord(text: string, words: readonly string[]): boolean {
  return words.some((w) => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, "iu").test(text));
}

function unconfirmed(leg: Leg, reason: UnconfirmedReason): PricedLeg {
  const ui: PriceMeta = { status: "unconfirmed", reason };
  return makePricedLeg({
    leg,
    amount: 0,
    currency: "PLN",
    price_type: "szacunek",
    notes: "",
    breakdown: { cena_nieznana: true, price_verified: false, ui },
  });
}

export function priceLeg(leg: Leg, discounts: DiscountProfile): PricedLeg {
  if (leg.mode === LegMode.WALK) {
    return makePricedLeg({ leg, amount: 0, currency: "PLN", price_type: "oficjalna_taryfa", breakdown: {} });
  }
  const o = leg.extra["origin_lat"], oLon = leg.extra["origin_lon"];
  const d = leg.extra["destination_lat"], dLon = leg.extra["destination_lon"];
  if (![o, oLon, d, dLon].every((x) => typeof x === "number")) return unconfirmed(leg, "noCoords");
  const [lat1, lon1, lat2, lon2] = [o, oLon, d, dLon] as number[];

  if (leg.mode !== LegMode.RAIL) {
    return unconfirmed(leg, /flix/i.test(leg.carrier_name) ? "flixbus" : "local");
  }

  const c1 = countryOf(lat1, lon1);
  const c2 = countryOf(lat2, lon2);
  const text = `${leg.carrier_name} ${String(leg.extra["route_short_name"] ?? "")} ${String(leg.extra["route_long_name"] ?? "")}`;
  const lower = text.toLowerCase();
  const date = leg.depart.toISOString().slice(0, 10);

  try {
    if (/pkp intercity/.test(lower)) {
      if (c1 !== "PL" || c2 !== "PL") return unconfirmed(leg, "crossBorder");
      if (matchesWord(text, ["EIC", "EIP", "Pendolino", "Express InterCity"])) return unconfirmed(leg, "premiumTrain");
      if (!matchesWord(text, ["IC", "TLK", "InterCity"])) return unconfirmed(leg, "unknownCategory");
      const segment = makeSegment({
        carrier: Carrier.PKP_INTERCITY,
        origin: leg.origin_name,
        destination: leg.destination_name,
        distance_km: haversineKm(lat1, lon1, lat2, lon2),
        discounts,
        travel_date: date,
      });
      const r = estimatePkp(segment);
      const verified = typeof r.breakdown["data_weryfikacji"] === "string" ? (r.breakdown["data_weryfikacji"] as string) : undefined;
      // The band table has no recorded verification date (data/fares/pkp_intercity.json): until
      // somebody compares it with the PDF, it is shown as an estimate, not as an official fare.
      const ui: PriceMeta = {
        status: verified ? "official" : "estimate",
        source: "Cennik PKP Intercity (TLK/IC, 2. klasa)",
        sourceUrl: String(r.breakdown["zrodlo_url"] ?? ""),
        verified,
        reason: verified ? undefined : "noVerifiedDate",
      };
      return makePricedLeg({
        leg,
        amount: r.amount,
        currency: r.currency,
        price_type: r.price_type,
        notes: r.notes,
        breakdown: { ...r.breakdown, price_verified: !!verified, ui },
        carrier: r.carrier,
      });
    }

    if (/db fernverkehr|deutsche bahn/.test(lower) || leg.carrier_name.trim().toLowerCase() === "db") {
      if (c1 !== "DE" || c2 !== "DE") return unconfirmed(leg, "crossBorder");
      const segment = makeSegment({
        carrier: Carrier.DB,
        origin: leg.origin_name,
        destination: leg.destination_name,
        distance_km: haversineKm(lat1, lon1, lat2, lon2),
        discounts,
        travel_date: date,
      });
      const r = estimateDb(segment);
      const ui: PriceMeta = {
        status: "estimate",
        source: "Model szacunkowy DB Flexpreis (BahnCard: bahn.de)",
        sourceUrl: DB_SOURCE_URL,
        reason: "dbModel",
      };
      return makePricedLeg({
        leg,
        amount: r.amount,
        currency: r.currency,
        price_type: r.price_type,
        notes: r.notes,
        breakdown: { ...r.breakdown, ui },
        carrier: r.carrier,
      });
    }
  } catch {
    return unconfirmed(leg, "calcError");
  }

  if (c1 !== null && c2 !== null && c1 !== c2) return unconfirmed(leg, "crossBorder");
  return unconfirmed(leg, "otherCarrier");
}

export const metaOf = (pl: PricedLeg): PriceMeta =>
  (pl.breakdown["ui"] as PriceMeta | undefined) ?? { status: "official" };
