// Port of fares/zvon_gorlitz.py: EuropastadtTarif Görlitz–Zgorzelec, Einzelfahrt.
import table from "../../../data/fares/zvon_gorlitz.json";
import { ValueError } from "../pyCompat";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;
const BILET: Table = TABLE["einzelfahrt"];
const WIEK_PONIZEJ: number = TABLE["ermaessigt_wiek_ponizej"];
const ZRODLO: string = TABLE["weryfikacja"]["url"];
const DATA: string = TABLE["weryfikacja"]["data"];

export function maUlge(segment: Segment): boolean {
  const age = segment.discounts.age;
  return age !== null && age < WIEK_PONIZEJ;
}

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.ZVON_GORLITZ) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora ZVON: ${segment.carrier}`);
  }
  const ulgowy = maUlge(segment);
  return {
    carrier: Carrier.ZVON_GORLITZ,
    amount: ulgowy ? BILET["ermaessigt"] : BILET["normalny"],
    currency: TABLE["waluta"],
    price_type: PriceType.OFFICIAL,
    breakdown: {
      relacja: `${segment.origin} <-> ${segment.destination}`,
      typ_biletu: ulgowy ? "Einzelfahrt ermäßigt" : "Einzelfahrt normal",
      bilet_wazny_min: BILET["wazny_min"],
      taryfa: "EuropastadtTarif (Görlitz–Zgorzelec)",
      price_verified: true,
      zrodlo: ZRODLO,
      data_weryfikacji: DATA,
    },
    notes:
      `EuropastadtTarif ZVON, Einzelfahrt (ważny ${BILET["wazny_min"]} min od skasowania), ` +
      `zweryfikowano ${DATA}: ${ZRODLO}. ` +
      (ulgowy
        ? `Cena ermäßigt: ulga tylko dla uczniów do 15. urodzin (wiek ${segment.discounts.age} ` +
          "< 15; zakładamy status ucznia, którego wiek sam nie potwierdza)."
        : "Cena normalna (ulga ermäßigt tylko dla uczniów do 15. urodzin)."),
  };
}
