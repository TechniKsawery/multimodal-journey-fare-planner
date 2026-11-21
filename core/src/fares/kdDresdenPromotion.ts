// Port of fares/kd_dresden_promotion.py: fixed-price offer "Dresden Promotion" (Koleje Dolnośląskie + Die Länderbahn),
// one ticket from a listed Polish station to Dresden Hbf. Data: data/fares/kd_dresden_promotion.json (operator pages, read 2026-11-21).
// The sources do not say the offer is on sale today (`oferta_aktualna_potwierdzona=false`), so the price is ALWAYS an
// unconfirmed estimate — the caller sets price_verified=false. Stations outside the table have no price (nothing is guessed).
import table from "../../../data/fares/kd_dresden_promotion.json";
import { fold } from "../places/aliases";

export const CHILD_MIN_AGE = 6;
export const CHILD_MAX_AGE = 15;

type Row = (typeof table.ceny_za_osobe_do_drezna_hbf)[number];

/** Station name from the table without the bracketed remark ("Zgorzelec (niedostępne w kanałach internetowych)"). */
const stationKey = (name: string): string => fold(name.split("(")[0]);

const STATIONS = new Map<string, Row>(table.ceny_za_osobe_do_drezna_hbf.map((row) => [stationKey(row.stacja), row]));
export const DRESDEN_HBF_NAMES: ReadonlySet<string> = new Set(["dresden hbf", "dresden hauptbahnhof", "drezno glowne"]);

export const isOfferOrigin = (name: string): boolean => STATIONS.has(fold(name));
export const isDresdenHbf = (name: string): boolean => DRESDEN_HBF_NAMES.has(fold(name));

/** [one-way price in PLN, basis] or null when the station is not in the table or the age is below 6 (free with a full-fare passenger: not a price of this ticket). */
export function oneWayPrice(origin: string, age: number | null = null): [number, string] | null {
  const row = STATIONS.get(fold(origin));
  if (row === undefined) return null;
  if (age !== null && age < CHILD_MIN_AGE) return null;
  if (age !== null && age >= CHILD_MIN_AGE && age <= CHILD_MAX_AGE) return [row.w_jedna_strone_dziecko_6_15, "dziecko_6_15"];
  return [row.w_jedna_strone, "dorosly"];
}

export function sourceInfo(): { zrodlo_url: string; data_weryfikacji: string; oferta_aktualna_potwierdzona: boolean } {
  return {
    zrodlo_url: table.zrodlo_url,
    data_weryfikacji: table.data_weryfikacji,
    oferta_aktualna_potwierdzona: Boolean(table.oferta_aktualna_potwierdzona),
  };
}
