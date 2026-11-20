// Port of fares/koleje_mazowieckie.py: Koleje Mazowieckie (KM) Table no. 1, normal single ticket (gross).
import pkp from "../../../data/fares/pkp_intercity.json";
import table from "../../../data/fares/koleje_mazowieckie.json";
import { ValueError, pyList, pyRepr } from "../pyCompat";
import { bandFor, confirmationOf } from "./bands";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;
const ULGI: Record<string, number> = pkp["ulgi_procent"];

export function estimate(segment: Segment, tableOverride: Table | null = null): PriceEstimate {
  if (segment.carrier !== Carrier.KOLEJE_MAZOWIECKIE) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora Kolei Mazowieckich: ${segment.carrier}`);
  }
  if (segment.distance_km === null) throw new ValueError("Koleje Mazowieckie: distance_km jest wymagane");
  const tbl = tableOverride ?? TABLE;

  const ulgaKod = segment.discounts.pkp_ulga_kod;
  if (!Object.hasOwn(ULGI, ulgaKod)) {
    throw new ValueError(`nieznany kod ulgi: ${pyRepr(ulgaKod)}, dostępne: ${pyList(Object.keys(ULGI))}`);
  }
  const ulgaWnioskowana = ulgaKod !== "brak";

  const band = bandFor(tbl, segment.distance_km, "brak pasma taryfy Kolei Mazowieckich dla", " (tabela do 520)");
  const amount: number = band["cena"];
  const confirmation = confirmationOf(band);
  const verified = confirmation !== null && !ulgaWnioskowana;
  const official = verified && segment.distance_along_track;
  const breakdown: Record<string, unknown> = {
    cena_bazowa: amount,
    cena_netto: band["netto"] ?? null,
    ptu: band["ptu"] ?? null,
    pasmo_do_km: band["do_km"],
    pasmo: band["zakres"] ?? null,
    ulga_kod: ulgaKod,
    klasa: tbl["klasa"],
    price_verified: verified,
    odleglosc_taryfowa: segment.distance_along_track ? "po torach" : "linia prosta",
    obowiazuje_od: tbl["obowiazuje_od"] ?? null,
  };
  if (segment.distance_along_track && segment.distance_source) breakdown["zrodlo_km"] = segment.distance_source;
  let notes =
    "Bilet jednorazowy Kolei Mazowieckich wg Tabeli nr 1 taryfy TP-KM (taryfa normalna, " +
    `2. klasa, brutto), pasmo do ${band["do_km"]} km.`;
  if (confirmation !== null) {
    breakdown["zrodlo_url"] = confirmation["zrodlo_url"];
    breakdown["data_weryfikacji"] = confirmation["data"];
    notes += ` Kwota pasma: ${confirmation["zrodlo_url"]} (zweryfikowano ${confirmation["data"]}).`;
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
  if (ulgaWnioskowana) notes += " Ulgi KM nie są modelowane: pokazana cena normalna, niepotwierdzona dla ulgi.";
  if (!verified) {
    breakdown["powod_szacunku"] = ulgaWnioskowana
      ? "ulgi KM nie są modelowane (cena normalna)"
      : "pasmo niepotwierdzone w źródle pierwotnym";
  }

  return {
    carrier: Carrier.KOLEJE_MAZOWIECKIE,
    amount,
    currency: tbl["waluta"],
    price_type: official ? PriceType.OFFICIAL : PriceType.ESTIMATE,
    breakdown,
    notes,
  };
}
