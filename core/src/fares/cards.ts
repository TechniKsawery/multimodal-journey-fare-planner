// Port of fares/cards.py: is buying a BahnCard worth it for a route / number of journeys per year.
// A BahnCard is a PRODUCT TO BUY (unlike statutory PKP discounts), hence the separate logic.
import bahncard from "../../../data/fares/bahncard.json";
import dbFlexpreis from "../../../data/fares/db_flexpreis.json";
import { ValueError, compareIsoDates, formatFixed, round2, roundInt } from "../pyCompat";
import { flexpreisUpperBound } from "./db";
import type { Table } from "./model";

const TABLE: Table = bahncard;
const MNOZNIK_TABLE: Record<string, number> = dbFlexpreis["bahncard_mnoznik"];

export interface CardSuggestion {
  variant_key: string;
  nazwa: string;
  cena_karty: number;
  waluta: string;
  cena_biletu_bez_karty: number; // Flexpreis for ONE journey, without a card
  cena_biletu_z_karta: number; // Flexpreis for ONE journey with the card's discount (excluding the card)
  oszczednosc_rocznie: number; // positive = buying pays off for the given number of journeys
  journeys_needed_to_break_even: number | null; // null when it already pays off
  rekomendowana: boolean;
  opis: string;
}

/** Discount (%) of an already owned card, derived from the same multiplier table as the real ticket price. */
function existingDiscountPercent(existing: string | null): number {
  const key = existing || "brak";
  const mnoznik = Object.hasOwn(MNOZNIK_TABLE, key) ? MNOZNIK_TABLE[key] : 1.0;
  return roundInt((1 - mnoznik) * 100);
}

function effectivePrice(wariant: Table, referenceDate: string): number {
  const promocjaDo: string | null = wariant["promocja_do"] ?? null;
  const promocjaOd: string | null = wariant["promocja_od"] ?? null;
  if (
    promocjaDo &&
    Object.hasOwn(wariant, "cena_promocyjna") &&
    (!promocjaOd || compareIsoDates(promocjaOd, referenceDate) <= 0) &&
    compareIsoDates(referenceDate, promocjaDo) <= 0
  ) {
    return wariant["cena_promocyjna"];
  }
  return wariant["cena_roczna"];
}

function eligible(wariant: Table, age: number | null): boolean {
  const min: number | null = wariant["wiek_min"];
  const max: number | null = wariant["wiek_max"];
  if (min === null && max === null) return true; // standard BahnCard: any age
  if (age === null) return false; // the variant needs an age and none was given
  return (min as number) <= age && age <= (max as number);
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function suggestBahncard(
  distanceKm: number,
  journeysPerYear = 2,
  age: number | null = null,
  referenceDate: string | null = null,
  existingBahncard: string | null = null,
): CardSuggestion[] {
  if (distanceKm <= 0) throw new ValueError("distance_km musi być dodatnie");
  return suggestBahncardForTotalPrice(flexpreisUpperBound(distanceKm), journeysPerYear, age, referenceDate, existingBahncard);
}

/**
 * Like {@link suggestBahncard} but takes an already computed total Flexpreis price. For a variant
 * with several DB tickets pass the SUM of the individual ticket prices (each from its own band).
 */
export function suggestBahncardForTotalPrice(
  upperBound: number,
  journeysPerYear = 2,
  age: number | null = null,
  referenceDate: string | null = null,
  existingBahncard: string | null = null,
): CardSuggestion[] {
  if (upperBound <= 0) throw new ValueError("upper_bound musi być dodatnie");
  if (journeysPerYear <= 0) throw new ValueError("journeys_per_year musi być dodatnie");

  const ref = referenceDate ?? today();
  const waluta: string = TABLE["waluta"];
  const existingPercent = existingDiscountPercent(existingBahncard);
  const currentPrice = round2(upperBound * (1 - existingPercent / 100));

  const results: CardSuggestion[] = [];
  for (const [key, wariant] of Object.entries(TABLE["warianty"] as Record<string, Table>)) {
    if (!eligible(wariant, age)) continue;
    if (wariant["rabat_procent"] <= existingPercent) continue; // already owns an equal or better card

    const cenaKarty = effectivePrice(wariant, ref);
    const cenaZKarta = round2(upperBound * (1 - wariant["rabat_procent"] / 100));
    const savingsPerJourney = round2(currentPrice - cenaZKarta);
    const oszczednosc = round2(savingsPerJourney * journeysPerYear - cenaKarty);
    const f = (x: number) => formatFixed(x, 2);
    const posiadanaInfo =
      existingPercent > 0 ? ` (masz już ${existingBahncard}% rabatu — obecna cena to ${f(currentPrice)} ${waluta})` : "";

    if (oszczednosc > 0) {
      results.push({
        variant_key: key,
        nazwa: wariant["nazwa"],
        cena_karty: cenaKarty,
        waluta,
        cena_biletu_bez_karty: currentPrice,
        cena_biletu_z_karta: cenaZKarta,
        oszczednosc_rocznie: oszczednosc,
        journeys_needed_to_break_even: null,
        rekomendowana: true,
        opis:
          `Kup ${wariant["nazwa"]} za ${f(cenaKarty)} ${waluta} — bilet na tej trasie ` +
          `zapłacisz ${f(cenaZKarta)} ${waluta} zamiast ${f(currentPrice)} ${waluta}` +
          `${posiadanaInfo}; przy ${journeysPerYear} podróżach/rok zaoszczędzisz łącznie ` +
          `${f(oszczednosc)} ${waluta}/rok (po odjęciu ceny karty).`,
      });
    } else {
      const breakEven = savingsPerJourney > 0 ? Math.ceil(cenaKarty / savingsPerJourney) : null;
      const opis =
        breakEven !== null
          ? `${wariant["nazwa"]} (${f(cenaKarty)} ${waluta}/rok): bilet na tej trasie kosztowałby ` +
            `${f(cenaZKarta)} ${waluta} zamiast ${f(currentPrice)} ${waluta}${posiadanaInfo}, ale ` +
            `przy ${journeysPerYear} podróżach/rok karta jeszcze się nie zwraca — opłaca się ` +
            `dopiero od ${breakEven} podróży/rok.`
          : `${wariant["nazwa"]}: brak dodatkowego rabatu względem posiadanej karty, nie zwróci się.`;
      results.push({
        variant_key: key,
        nazwa: wariant["nazwa"],
        cena_karty: cenaKarty,
        waluta,
        cena_biletu_bez_karty: currentPrice,
        cena_biletu_z_karta: cenaZKarta,
        oszczednosc_rocznie: oszczednosc,
        journeys_needed_to_break_even: breakEven,
        rekomendowana: false,
        opis,
      });
    }
  }

  // Recommended first (largest saving first), then by the fewest journeys needed to break even.
  const rank = (r: CardSuggestion): [number, number] => [
    r.rekomendowana ? 0 : 1,
    r.rekomendowana ? -r.oszczednosc_rocznie : r.journeys_needed_to_break_even || Infinity,
  ];
  results.sort((a, b) => {
    const [a0, a1] = rank(a);
    const [b0, b1] = rank(b);
    return a0 - b0 || (a1 < b1 ? -1 : a1 > b1 ? 1 : 0);
  });
  return results;
}

export function bestBahncardSuggestion(
  distanceKm: number,
  journeysPerYear = 2,
  age: number | null = null,
  referenceDate: string | null = null,
  existingBahncard: string | null = null,
): CardSuggestion | null {
  const suggestions = suggestBahncard(distanceKm, journeysPerYear, age, referenceDate, existingBahncard);
  return suggestions[0] ?? null;
}
