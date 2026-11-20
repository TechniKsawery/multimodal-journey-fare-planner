// Port of fares/koleje_malopolskie.py: Koleje Małopolskie (KMŁ) Table no. 1, normal single ticket.
import pkp from "../../../data/fares/pkp_intercity.json";
import table from "../../../data/fares/koleje_malopolskie.json";
import { ValueError, pyList, pyRepr } from "../pyCompat";
import { bandFor, confirmationOf } from "./bands";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;
const ULGI: Record<string, number> = pkp["ulgi_procent"];

export const STATUS_WERYFIKACJI = "wg Gemini, niezweryfikowane niezależnie";

function independentlyVerified(confirmation: Table | null): boolean {
  return confirmation !== null && (confirmation["status"] ?? null) !== STATUS_WERYFIKACJI;
}

export function estimate(segment: Segment, tableOverride: Table | null = null): PriceEstimate {
  if (segment.carrier !== Carrier.KOLEJE_MALOPOLSKIE) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora Kolei Małopolskich: ${segment.carrier}`);
  }
  if (segment.distance_km === null) throw new ValueError("Koleje Małopolskie: distance_km jest wymagane");
  const tbl = tableOverride ?? TABLE;

  const ulgaKod = segment.discounts.pkp_ulga_kod;
  if (!Object.hasOwn(ULGI, ulgaKod)) {
    throw new ValueError(`nieznany kod ulgi: ${pyRepr(ulgaKod)}, dostępne: ${pyList(Object.keys(ULGI))}`);
  }
  const ulgaWnioskowana = ulgaKod !== "brak";

  const band = bandFor(tbl, segment.distance_km, "brak pasma taryfy Kolei Małopolskich dla");
  const amount: number = band["cena"];

  const confirmation = confirmationOf(band);
  // KMŁ discounts are not modelled: a passenger with a discount gets the normal price, not a price-list reading.
  const verified = independentlyVerified(confirmation) && !ulgaWnioskowana;
  const official = verified && segment.distance_along_track;
  const obowiazujeOd = tbl["obowiazuje_od"] ?? null;
  const breakdown: Record<string, unknown> = {
    cena_bazowa: amount,
    pasmo_do_km: band["do_km"],
    pasmo: band["zakres"] ?? null,
    ulga_kod: ulgaKod,
    klasa: tbl["klasa"],
    price_verified: verified,
    odleglosc_taryfowa: segment.distance_along_track ? "po torach" : "linia prosta",
    status_weryfikacji: STATUS_WERYFIKACJI,
    obowiazuje_od: obowiazujeOd,
  };
  if (segment.distance_along_track && segment.distance_source) breakdown["zrodlo_km"] = segment.distance_source;
  const obowiazujeOpis = obowiazujeOd
    ? `od ${obowiazujeOd}`
    : "data wejścia w życie: brak w raporcie, niezweryfikowana";
  let notes =
    "Bilet jednorazowy Kolei Małopolskich wg Tabeli nr 1 taryfy TP-KMŁ (taryfa normalna, " +
    `2. klasa, pociąg osobowy; ${obowiazujeOpis}), pasmo do ${band["do_km"]} km. Tabela nie ` +
    "obowiązuje do/z Kraków Lotnisko.";
  if (confirmation !== null) {
    breakdown["zrodlo_url"] = confirmation["zrodlo_url"];
    breakdown["data_weryfikacji"] = confirmation["data"];
    notes +=
      ` Kwota pasma ${confirmation["status"] ?? STATUS_WERYFIKACJI}: ` +
      `${confirmation["zrodlo_url"]} (${confirmation["data"]}).`;
  } else {
    notes += " Cena NIEPOTWIERDZONA: pasmo bez źródła w pliku danych.";
  }
  if (segment.distance_along_track && segment.distance_source) {
    notes += ` Kilometry po torach: ${segment.distance_source}.`;
  }
  if (!segment.distance_along_track) {
    notes +=
      " Pasmo dobrane z odległości w linii prostej, nie z km po torach — cena przybliżona " +
      "(rzeczywiste pasmo może być wyższe).";
  }
  if (ulgaWnioskowana) notes += " Ulgi KMŁ nie są modelowane: pokazana cena normalna, niepotwierdzona dla ulgi.";
  if (!verified) {
    let reason: string;
    if (confirmation === null) reason = "pasmo niepotwierdzone w źródle pierwotnym";
    else if (!independentlyVerified(confirmation)) {
      reason = "kwota tylko z raportu Gemini, bez drugiego niezależnego źródła";
    } else reason = "ulgi KMŁ nie są modelowane (cena normalna)";
    breakdown["powod_szacunku"] = reason;
  }

  return {
    carrier: Carrier.KOLEJE_MALOPOLSKIE,
    amount,
    currency: tbl["waluta"],
    price_type: official ? PriceType.OFFICIAL : PriceType.ESTIMATE,
    breakdown,
    notes,
  };
}
