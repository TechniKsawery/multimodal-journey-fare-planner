// Port of fares/bilet_graniczny_zasieki_forst.py: fixed 5.00 PLN border ticket, no statutory discounts.
import table from "../../../data/fares/bilet_graniczny_zasieki_forst.json";
import { ValueError } from "../pyCompat";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;

export function dzieckoGratis(segment: Segment): boolean {
  const age = segment.discounts.age;
  return age !== null && age < TABLE["dzieci_gratis_wiek_ponizej"];
}

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.BILET_GRANICZNY_ZASIEKI_FORST) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora biletu granicznego: ${segment.carrier}`);
  }
  const weryfikacja: Table = TABLE["weryfikacja"];
  const gratis = dzieckoGratis(segment);
  const bezDoplaty: Table = TABLE["bilety_bez_doplaty"];
  const breakdown = {
    relacja: `${segment.origin} <-> ${segment.destination}`,
    typ_biletu: "Bilet graniczny Polska-Niemcy" + (gratis ? " (dziecko gratis)" : ""),
    kierunek: TABLE["kierunek"],
    ulgi_ustawowe: TABLE["ulgi_ustawowe"],
    obowiazuje_od: TABLE["obowiazuje_od"],
    price_verified: true,
    status_weryfikacji: weryfikacja["status"],
    zrodlo_url: weryfikacja["url"],
    zrodlo_url_strony: weryfikacja["url_strony"],
    dodatek_do_biletu_krajowego: true,
    bilety_bez_doplaty: [...bezDoplaty["bilety"]],
    bilet_bez_doplaty_info_niezweryfikowany_w_profilu: true,
    okaziciel: TABLE["okaziciel"],
    max_osob_na_blankiecie: TABLE["max_osob_na_blankiecie"],
    bagaz_rower_pies_bezplatnie: TABLE["bagaz_rower_pies_bezplatnie"],
    przedsprzedaz_dni: TABLE["przedsprzedaz_dni"],
    dzieci_gratis_niejednoznaczne: TABLE["dzieci_gratis_niejednoznaczne"],
    data_odczytu: weryfikacja["data_odczytu"],
  };
  let notes =
    "Bilet graniczny Polska-Niemcy Zasieki - Forst (KD Zasieki - Zasieki(Gr) + DB Regio " +
    `Zasieki(Gr) - Forst), w jedną stronę, od ${TABLE["obowiazuje_od"]}; regulamin odczytany ` +
    `${weryfikacja["data_odczytu"]}. ${TABLE["dodatek_do_biletu_krajowego"]["tresc"]} ` +
    `Bilet na okaziciela (do ${TABLE["max_osob_na_blankiecie"]} osób na blankiecie), rower, ` +
    `bagaż i pies bezpłatnie, przedsprzedaż ${TABLE["przedsprzedaz_dni"]} dni. ` +
    `${bezDoplaty["tresc"]} Profil pasażera nie obejmuje jeszcze tych biletów, więc cena ` +
    "nie jest obniżana - jeśli masz któryś z nich, dopłata 5 zł nie obowiązuje. ";
  if (gratis) {
    notes +=
      `Dziecko do ${TABLE["dzieci_gratis_wiek_ponizej"]} lat (wiek ${segment.discounts.age}) ` +
      "jedzie bezpłatnie (granica wieku w regulaminie niejednoznaczna: poniżej 6 lat " +
      "traktowane jako gratis).";
  } else {
    notes += "Stała cena; brak ulg ustawowych (§5 ust. 2), uczniowie i studenci płacą pełną cenę.";
  }
  return {
    carrier: Carrier.BILET_GRANICZNY_ZASIEKI_FORST,
    amount: gratis ? 0.0 : TABLE["cena"],
    currency: TABLE["waluta"],
    price_type: PriceType.OFFICIAL,
    breakdown,
    notes,
  };
}
