// Port of fares/flixbus.py — FALLBACK PATH ONLY.
// Python first tries the unofficial FlixBus live API when `travel_date` is set. That API has no
// documented CORS/ToS guarantee and is deliberately not called from the browser app, so the port
// always uses the coarse PLN/km fallback (price_verified: false, an estimate). The golden vectors
// for FlixBus therefore cover segments without travel_date (the Python code path that is identical).
import fallback from "../../../data/fares/flixbus_fallback.json";
import { ValueError, formatFixed, round2 } from "../pyCompat";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const FALLBACK: Table = fallback;

export function fallbackEstimate(segment: Segment, reason: string): PriceEstimate {
  if (segment.distance_km === null) {
    throw new ValueError("FlixBus: distance_km jest wymagane (do fallbacku po km, gdy API niedostępne)");
  }
  const plnPerKm: number = FALLBACK["pln_per_km"];
  return {
    carrier: Carrier.FLIXBUS,
    amount: round2(plnPerKm * segment.distance_km),
    currency: "PLN",
    price_type: PriceType.ESTIMATE,
    breakdown: {
      zrodlo: "fallback_km",
      price_verified: false,
      pln_per_km: plnPerKm,
      odleglosc_km: segment.distance_km,
    },
    notes:
      `${reason} Fallback: ${plnPerKm} PLN/km x ${formatFixed(segment.distance_km, 0)} km ` +
      "(bardzo zgrubny szacunek, patrz data/fares/flixbus_fallback.json).",
  };
}

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.FLIXBUS) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora FlixBus: ${segment.carrier}`);
  }
  return fallbackEstimate(
    segment,
    segment.travel_date
      ? "API FlixBus niedostępne/bez wyniku (nie pobierane w tej aplikacji: brak serwera)"
      : "Brak travel_date w segmencie — API FlixBus wymaga konkretnej daty przejazdu.",
  );
}
