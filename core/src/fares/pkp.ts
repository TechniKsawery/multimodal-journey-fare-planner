// Port of fares/pkp.py: PKP Intercity price = distance band x discount multiplier.
import table from "../../../data/fares/pkp_intercity.json";
import { ValueError, pyList, pyRepr, round2 } from "../pyCompat";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;

function basePrice(distanceKm: number): number {
  for (const pasmo of TABLE["pasma_odleglosci_km"]) {
    if (pasmo["do_km"] === null || distanceKm <= pasmo["do_km"]) return pasmo["cena"];
  }
  throw new ValueError("brak pasma cenowego dla podanej odległości");
}

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.PKP_INTERCITY) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora PKP: ${segment.carrier}`);
  }
  if (segment.distance_km === null) throw new ValueError("PKP Intercity: distance_km jest wymagane");

  const ulgaKod = segment.discounts.pkp_ulga_kod;
  const ulgi: Record<string, number> = TABLE["ulgi_procent"];
  if (!Object.hasOwn(ulgi, ulgaKod)) {
    throw new ValueError(`nieznany kod ulgi PKP: ${pyRepr(ulgaKod)}, dostępne: ${pyList(Object.keys(ulgi))}`);
  }

  const base = basePrice(segment.distance_km);
  const ulgaProcent = ulgi[ulgaKod];
  const amount = round2(base * (1 - ulgaProcent / 100));

  const breakdown: Record<string, unknown> = {
    cena_bazowa: base,
    ulga_kod: ulgaKod,
    ulga_procent: ulgaProcent,
    klasa: TABLE["klasa"],
    zrodlo_url: TABLE["zrodlo_url_cennik"],
  };
  if (ulgaProcent) breakdown["zrodlo_ulgi_url"] = TABLE["zrodlo_url_ulgi"];
  if (TABLE["data_weryfikacji"]) breakdown["data_weryfikacji"] = TABLE["data_weryfikacji"];

  return {
    carrier: Carrier.PKP_INTERCITY,
    amount,
    currency: TABLE["waluta"],
    price_type: PriceType.OFFICIAL,
    breakdown,
    notes:
      "Cena bazowa i ulga z oficjalnego cennika/tabeli ulg PKP Intercity dla TLK/IC " +
      "2. klasy — patrz pole _zrodlo w data/fares/pkp_intercity.json. Nie obejmuje " +
      "promocji/ofert specjalnych ani cen EIC/EIP (ustalanych per relacja).",
  };
}
