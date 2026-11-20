// Port of fares/international.py: PL<->DE through ticket (Super Sparpreis Europa) with fixed price categories.
import table from "../../../data/fares/international_pl_de.json";
import { ValueError, fileOrderKeys, formatFixed, pyList, pyRepr, round2, roundN } from "../pyCompat";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;

function tier(distanceKm: number): Table {
  for (const prog of TABLE["progi_km"] as Table[]) {
    if (prog["do_km"] === null || distanceKm <= prog["do_km"]) return prog;
  }
  throw new ValueError("brak progu cenowego dla podanej odległości");
}

const isInfantFree = (age: number | null): boolean => age !== null && age < TABLE["dziecko_bezplatnie_wiek_max"];
const isChildAge = (age: number | null): boolean =>
  age !== null && TABLE["dziecko_wiek_min"] <= age && age <= TABLE["dziecko_wiek_max"];
const isYoung = (age: number | null): boolean =>
  age !== null && TABLE["young_wiek_min"] <= age && age <= TABLE["young_wiek_max"];

/**
 * Discounts that apply only to the German part of the route (BahnCard and the child discount):
 * effective discount = nominal discount x German share; without coordinates (fraction null)
 * the fallback applies the discount to the whole price (which overstates it).
 */
function germanPortionDiscount(nominalRabatProcent: number, fraction: number | null): [number, string] {
  if (fraction === null) {
    return [nominalRabatProcent, "brak współrzędnych stacji — rabat naliczony od całej ceny (zawyża realny rabat)"];
  }
  const f = Math.max(0.0, Math.min(1.0, fraction));
  return [
    nominalRabatProcent * f,
    "rabat naliczony proporcjonalnie do szacowanego udziału niemieckiego odcinka trasy " +
      `(~${formatFixed(f * 100, 0)}% dystansu w linii prostej)`,
  ];
}

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.INTERNATIONAL_PL_DE) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora międzynarodowego: ${segment.carrier}`);
  }
  if (segment.distance_km === null) {
    throw new ValueError("bilet międzynarodowy PL-DE: distance_km jest wymagane");
  }
  const age = segment.discounts.age;

  if (isInfantFree(age)) {
    return {
      carrier: Carrier.INTERNATIONAL_PL_DE,
      amount: 0.0,
      currency: TABLE["waluta"],
      price_type: PriceType.ESTIMATE,
      breakdown: { kategoria_relacji: "niemowle", wiek: age },
      notes:
        `Bilet międzynarodowy PL-DE, dziecko poniżej ${TABLE["dziecko_bezplatnie_wiek_max"]} ` +
        "lat — zawsze przejazd bezpłatny (bahn.de, Super Sparpreis Europa Polen).",
    };
  }

  if (isChildAge(age) && segment.discounts.child_with_guardian) {
    return {
      carrier: Carrier.INTERNATIONAL_PL_DE,
      amount: 0.0,
      currency: TABLE["waluta"],
      price_type: PriceType.ESTIMATE,
      breakdown: { kategoria_relacji: "dziecko_z_opiekunem", wiek: age },
      notes:
        `Bilet międzynarodowy PL-DE, dziecko ${TABLE["dziecko_wiek_min"]}-` +
        `${TABLE["dziecko_wiek_max"]} lat podróżujące w towarzystwie osoby od 15 lat — ` +
        "przejazd bezpłatny (bahn.de, Super Sparpreis Europa Polen), zgłoszone przy rezerwacji.",
    };
  }

  if (isChildAge(age)) {
    const prog = tier(segment.distance_km);
    const cenaOd: number = prog["cena_od"];
    const rabatProcent: number = TABLE["dziecko_samodzielnie_rabat_procent"];
    const [efektywny, podzialNote] = germanPortionDiscount(rabatProcent, segment.german_portion_fraction);
    const amount = round2(cenaOd * (1 - efektywny / 100));
    return {
      carrier: Carrier.INTERNATIONAL_PL_DE,
      amount,
      currency: TABLE["waluta"],
      price_type: PriceType.ESTIMATE,
      breakdown: {
        kategoria_relacji: "dziecko_samodzielnie",
        cena_od: cenaOd,
        wiek: age,
        rabat_procent_nominalny: rabatProcent,
        udzial_niemieckiego_odcinka: segment.german_portion_fraction,
        rabat_procent_efektywny: roundN(efektywny, 1),
      },
      notes:
        `Bilet międzynarodowy PL-DE, dziecko ${TABLE["dziecko_wiek_min"]}-` +
        `${TABLE["dziecko_wiek_max"]} lat podróżujące SAMODZIELNIE — 50% zniżki, ale ` +
        `TYLKO na niemiecki odcinek trasy (bahn.de): ${podzialNote}. Polski odcinek ` +
        "pozostaje bez tego rabatu (konserwatywne uproszczenie — zaniża, nie zawyża, " +
        "realny rabat na całość biletu). BahnCard pominięta dla tej kategorii wieku.",
    };
  }

  const young = isYoung(age);
  let kategoriaRelacji: string;
  let cenaOd: number;
  if (young) {
    kategoriaRelacji = "young";
    cenaOd = TABLE["young_cena_od"];
  } else {
    const prog = tier(segment.distance_km);
    kategoriaRelacji = prog["kategoria"];
    cenaOd = prog["cena_od"];
  }

  const bahncard = segment.discounts.bahncard || "brak";
  const rabaty: Record<string, number> = TABLE["bahncard_rabat_procent"];
  if (!Object.hasOwn(rabaty, bahncard)) {
    throw new ValueError(`nieznana BahnCard: ${pyRepr(bahncard)}, dostępne: ${pyList(fileOrderKeys(rabaty))}`);
  }
  const rabatProcent = rabaty[bahncard];
  const [efektywny, podzialNote] = germanPortionDiscount(rabatProcent, segment.german_portion_fraction);
  const amount = round2(cenaOd * (1 - efektywny / 100));

  return {
    carrier: Carrier.INTERNATIONAL_PL_DE,
    amount,
    currency: TABLE["waluta"],
    price_type: PriceType.ESTIMATE,
    breakdown: {
      kategoria_relacji: kategoriaRelacji,
      cena_od: cenaOd,
      bahncard,
      rabat_procent_nominalny: rabatProcent,
      udzial_niemieckiego_odcinka: segment.german_portion_fraction,
      rabat_procent_efektywny: roundN(efektywny, 1),
      dystans_km_linia_prosta: roundN(segment.distance_km, 1),
      wiek: age,
    },
    notes:
      (young
        ? "Bilet międzynarodowy PL-DE, taryfa 'Super Sparpreis Europa Young' " +
          `(${TABLE["young_wiek_min"]}-${TABLE["young_wiek_max"]} lat, bahn.de) — JEDNA ` +
          "cena 'od' dla wszystkich relacji (bahn.de nie podaje progów zależnych od " +
          "odległości dla tej oferty, w przeciwieństwie do wersji dla dorosłych), " +
          "promocyjna/ograniczona pula, realna cena rynkowa może być wyższa. "
        : `Bilet międzynarodowy PL-DE, kategoria '${kategoriaRelacji}' wg przybliżenia ` +
          "odległością w linii prostej (DB nie publikuje tabeli relacja->kategoria) — " +
          "Super Sparpreis Europa, cena 'OD' (promocyjna, ograniczona pula miejsc), " +
          "realna cena rynkowa może być wyższa. Brak osobnej taryfy seniora na tej " +
          "ofercie — 'Super Sparpreis Senioren' (65+) to inny, wyłącznie krajowy produkt DB. ") +
      "BahnCard (każdy poziom: 25/50/100) daje " +
      `nominalnie 25% zniżki, ale OFICJALNIE TYLKO na niemiecki odcinek trasy — ${podzialNote}. ` +
      "Podział wg linii prostej i stałego przybliżonego punktu granicy — patrz " +
      "_uwaga_bahncard w danych źródłowych i BORDER_CROSSING_PL_DE w routing/pricing.py.",
  };
}
