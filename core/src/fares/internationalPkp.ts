// Port of fares/international_pkp.py: PKP Intercity's OWN "Polska-Niemcy" offer on the same trains as the DB
// tariff in international.ts, and the Super Promo International (SPI) price RANGE. The relation is recognised
// by city name only; an unknown city means "no PKP offer in our data" (null), not an error.
import tableData from "../../../data/fares/international_pl_de_pkp.json";
import spiData from "../../../data/fares/pkp_spi_pl_de.json";
import { ValueError, formatFixed, round2 } from "../pyCompat";
import { Carrier, PriceType, carrierRepr, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = tableData;
const SPI: Table = spiData;

/** Same normalisation as the oracle: ł->l, strip accents, lowercase, "-" -> space, collapse whitespace. */
function norm(text: string | null | undefined): string {
  const t = (text ?? "").replaceAll("ł", "l").replaceAll("Ł", "L").normalize("NFKD");
  return t
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replaceAll("-", " ")
    .split(/\s+/u)
    .filter((s) => s !== "")
    .join(" ");
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cityIn = (nameNorm: string, city: string): boolean =>
  new RegExp(`(?<![a-z])${escapeRegExp(norm(city))}(?![a-z])`).test(nameNorm);

const matchesAny = (name: string | null | undefined, keywords: string[]): boolean => {
  const lname = (name ?? "").toLowerCase();
  return keywords.some((k) => lname.includes(k));
};

export interface SpiRange {
  od: number;
  do: number;
  waluta: string;
  klasa: string;
  pociagi: string[];
  zrodlo: string;
  zrodlo_url: string;
  data_cennika: string;
}

/**
 * Price range of PKP Super Promo International (EUR, adult) for a Polish city <-> Berlin: lowest = level I,
 * highest = level V, taken as the min/max over ALL trains in the price list that have the Polish station in
 * one of their zones. null when neither (or both) ends is Berlin or the station is in no zone.
 */
export function spiRange(origin: string, destination: string, klasa = "klasa_2"): SpiRange | null {
  const berlinKw = TABLE["berlin_miasta"] as string[];
  const oBerlin = matchesAny(origin, berlinKw);
  const dBerlin = matchesAny(destination, berlinKw);
  if (oBerlin === dBerlin) return null;
  const plNorm = norm(oBerlin ? destination : origin);
  const dolne: number[] = [];
  const gorne: number[] = [];
  const pociagi: string[] = [];
  for (const pociag of SPI["pociagi"] as Table[]) {
    for (const [strefa, miasta] of Object.entries(pociag["strefy"] as Table)) {
      if ((miasta as string[]).some((m) => cityIn(plNorm, m))) {
        const tab = pociag["ceny_eur"]["Berlin"] as Table;
        const lo = tab["I"][strefa][klasa];
        const hi = tab["V"][strefa][klasa];
        if (typeof lo !== "number" || typeof hi !== "number") throw new TypeError("SPI price missing"); // Python: TypeError (not a ValueError)
        dolne.push(lo);
        gorne.push(hi);
        pociagi.push(`${pociag["numer"]} ${pociag["nazwa"]} (strefa ${strefa})`);
        break;
      }
    }
  }
  if (dolne.length === 0) return null;
  return {
    od: Math.min(...dolne),
    do: Math.max(...gorne),
    waluta: SPI["waluta"],
    klasa,
    pociagi,
    zrodlo: SPI["_zrodlo"],
    zrodlo_url: SPI["_zrodlo_url"],
    data_cennika: "2026-08-19",
  };
}

function relationPrice(origin: string, destination: string): [number, string] | null {
  const berlinKw = TABLE["berlin_miasta"] as string[];
  const oIsBerlin = matchesAny(origin, berlinKw);
  const dIsBerlin = matchesAny(destination, berlinKw);
  if (oIsBerlin === dIsBerlin) return null;
  const plSide = oIsBerlin ? destination : origin;
  for (const relacja of TABLE["relacje"] as Table[]) {
    if (matchesAny(plSide, relacja["miasta"])) return [relacja["cena"], relacja["miasta"][0]];
  }
  return null;
}

/** spiRange() for a segment, adults only: the SPI list has no concessions, so for infants and children we do not stretch SPI. */
export function spiRangeForSegment(segment: Segment): SpiRange | null {
  const age = segment.discounts.age;
  if (age !== null && age <= TABLE["dziecko_wiek_max"]) return null;
  return spiRange(segment.origin, segment.destination);
}

export function estimatePkpOffer(segment: Segment): PriceEstimate | null {
  if (segment.carrier !== Carrier.INTERNATIONAL_PL_DE) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora PKP PL-DE: ${carrierRepr(segment.carrier)}`);
  }
  const match = relationPrice(segment.origin, segment.destination);
  if (match === null) return null;
  const [cenaRegularna, etykietaRelacji] = match;

  const age = segment.discounts.age;
  let kategoriaWieku = "normalny";
  let rabatProcent = 0;
  if (age !== null && age < TABLE["niemowle_wiek_max"]) {
    kategoriaWieku = "niemowle";
    rabatProcent = TABLE["niemowle_rabat_procent"];
  } else if (age !== null && TABLE["dziecko_wiek_min"] <= age && age <= TABLE["dziecko_wiek_max"]) {
    kategoriaWieku = "dziecko";
    rabatProcent = TABLE["dziecko_rabat_procent"];
  } else if (age !== null && TABLE["mlodziez_wiek_min"] <= age && age <= TABLE["mlodziez_wiek_max"]) {
    kategoriaWieku = "mlodziez";
    rabatProcent = TABLE["mlodziez_rabat_procent"];
  }

  const amount = round2(cenaRegularna * (1 - rabatProcent / 100));
  return {
    carrier: Carrier.INTERNATIONAL_PL_DE,
    amount,
    currency: TABLE["waluta"],
    price_type: PriceType.ESTIMATE,
    breakdown: {
      oferta: "pkp_oferta_polska_niemcy",
      relacja_miasto_pl: etykietaRelacji,
      cena_regularna: cenaRegularna,
      kategoria_wieku: kategoriaWieku,
      rabat_procent: rabatProcent,
      wiek: age,
    },
    notes:
      "Własna oferta PKP Intercity 'Polska-Niemcy' (cennik regularny, 2 klasa) na tym " +
      `samym połączeniu: ${formatFixed(cenaRegularna, 2)} EUR` +
      (rabatProcent ? `, kategoria '${kategoriaWieku}' (-${rabatProcent}%)` : "") +
      ". Cena regularna to górna granica; PKP sprzedaje też tańszą, pulowaną ofertę " +
      'Super Promo International (przedział w breakdown["zakres_cen"], gdy relacja jest w cenniku SPI).',
  };
}
