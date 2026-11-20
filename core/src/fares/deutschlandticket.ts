// Port of fares/deutschlandticket.py: Deutschlandticket / BahnCard 100 holders pay 0 EUR extra on local and regional legs in
// Germany. This is a rule ("is the leg already paid by the ticket the user holds"), not a fare calculator. The scope comes
// ONLY from the quotes in data/fares/deutschlandticket.json::zakres_posiadacza (bahn.de, checked 2026-11-20).
import table from "../../../data/fares/deutschlandticket.json";
import type { DiscountProfile } from "./model";

export const SCOPE = table.zakres_posiadacza;

export const BASIS_DEUTSCHLANDTICKET = "deutschlandticket";
export const BASIS_BAHNCARD_100 = "bahncard_100";
export type Basis = typeof BASIS_DEUTSCHLANDTICKET | typeof BASIS_BAHNCARD_100;

// Long-distance train markers in the line name (auxiliary, next to the MOTIS mode and the carrier name).
export const LONG_DISTANCE_LINE = /^(?:ICE|IC|EC|ECE|EN|NJ|RJX?|FLX|TGV)(?:\s*-?\d+[A-Za-z]?)?$/i;
export const IRE_LINE = /^IRE(?:\s*-?\d+[A-Za-z]?)?$/i;

/** BahnCard 100 includes the Deutschlandticket; otherwise the explicit flag. null = holds neither. */
export function holderBasis(discounts: DiscountProfile): Basis | null {
  if (discounts.bahncard === "100") return BASIS_BAHNCARD_100;
  if (discounts.deutschlandticket) return BASIS_DEUTSCHLANDTICKET;
  return null;
}

export function sourceInfo(basis: Basis): Record<string, string> {
  if (basis === BASIS_BAHNCARD_100) {
    const bc = SCOPE.bahncard_100;
    return { zrodlo_url: bc.zrodlo_url, zrodlo_zakresu_url: SCOPE.zrodlo_url, data_weryfikacji: bc.data_weryfikacji, cytat: bc.cytat_deutschlandticket };
  }
  return { zrodlo_url: SCOPE.zrodlo_url, data_weryfikacji: SCOPE.data_weryfikacji, cytat: SCOPE.cytat_obowiazuje };
}

/** Not a long-distance line; IRE only for the BahnCard 100 (its source names IRE, the Deutschlandticket page does not). */
export function lineAllowed(routeShortName: string, basis: Basis): boolean {
  const name = routeShortName.trim();
  if (LONG_DISTANCE_LINE.test(name)) return false;
  return !(IRE_LINE.test(name) && basis !== BASIS_BAHNCARD_100);
}
