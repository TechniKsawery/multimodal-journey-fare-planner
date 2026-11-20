// Port of fares/polregio.py: POLREGIO / Koleje Dolnośląskie / Koleje Śląskie, degressive distance table.
import pkp from "../../../data/fares/pkp_intercity.json";
import table from "../../../data/fares/polregio_taryfa_podstawowa.json";
import { ValueError, pyList, pyRepr, round2 } from "../pyCompat";
import { bandFor, confirmationOf } from "./bands";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;
const ULGI: Record<string, number> = pkp["ulgi_procent"];

export function estimate(segment: Segment, tableOverride: Table | null = null): PriceEstimate {
  if (segment.carrier !== Carrier.POLREGIO_PODSTAWOWA) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora POLREGIO: ${segment.carrier}`);
  }
  if (segment.distance_km === null) throw new ValueError("POLREGIO: distance_km jest wymagane");
  const tbl = tableOverride ?? TABLE;

  const ulgaKod = segment.discounts.pkp_ulga_kod;
  if (!Object.hasOwn(ULGI, ulgaKod)) {
    throw new ValueError(`nieznany kod ulgi: ${pyRepr(ulgaKod)}, dostępne: ${pyList(Object.keys(ULGI))}`);
  }

  const band = bandFor(tbl, segment.distance_km, "brak pasma taryfy podstawowej dla");
  const base: number = band["cena"];
  const ulgaProcent = ULGI[ulgaKod];
  const amount = round2(base * (1 - ulgaProcent / 100));

  const confirmation = confirmationOf(band);
  // The band AMOUNT is confirmed; a discount is computed as a percentage, so it is not a price-list reading.
  const verified = confirmation !== null && ulgaProcent === 0;
  // Whether the band is the right one depends on tariff km (along the track); straight-line distance is an approximation.
  const official = verified && segment.distance_along_track;
  const breakdown: Record<string, unknown> = {
    cena_bazowa: base,
    pasmo_do_km: band["do_km"],
    ulga_kod: ulgaKod,
    ulga_procent: ulgaProcent,
    klasa: tbl["klasa"],
    price_verified: verified,
    odleglosc_taryfowa: segment.distance_along_track ? "po torach" : "linia prosta",
  };
  if (segment.distance_along_track && segment.distance_source) breakdown["zrodlo_km"] = segment.distance_source;
  let notes: string;
  if (confirmation !== null) {
    breakdown["zrodlo_url"] = confirmation["zrodlo_url"];
    breakdown["data_weryfikacji"] = confirmation["data"];
    notes =
      "Cena z tabeli odległościowej Taryfy Podstawowej POLREGIO/KD/KŚ (pociągi REGIO, " +
      `2. klasa), kwota pasma do ${band["do_km"]} km potwierdzona: ` +
      `${confirmation["zrodlo_url"]} (${confirmation["data"]}).`;
    if (segment.distance_along_track && segment.distance_source) {
      notes += ` Kilometry po torach: ${segment.distance_source}.`;
    }
    if (!segment.distance_along_track) {
      notes +=
        " Pasmo dobrane z odległości w linii prostej, nie z km po torach — cena " +
        "przybliżona (rzeczywiste pasmo może być wyższe).";
    }
  } else {
    notes =
      "Szacunek wg degresywnej tabeli Taryfy Podstawowej POLREGIO/KD/KŚ (pociągi REGIO, " +
      `2. klasa, pasmo do ${band["do_km"]} km) — cena NIEPOTWIERDZONA: pasmo bez źródła ` +
      "w pliku danych. POLREGIO w części województw stosuje własne taryfy regionalne " +
      "(m.in. Pomorska, Podlaska, Małopolska), a odległość to linia prosta, nie km po torach.";
  }
  if (ulgaProcent) notes += ` Ulga ${ulgaProcent}% policzona procentem od ceny bazowej.`;
  if (!verified) {
    breakdown["powod_szacunku"] =
      confirmation !== null
        ? "ulga policzona procentem, nie z tabeli ulg"
        : "pasmo niepotwierdzone w źródle pierwotnym";
  }

  return {
    carrier: Carrier.POLREGIO_PODSTAWOWA,
    amount,
    currency: tbl["waluta"],
    price_type: official ? PriceType.OFFICIAL : PriceType.ESTIMATE,
    breakdown,
    notes,
  };
}
