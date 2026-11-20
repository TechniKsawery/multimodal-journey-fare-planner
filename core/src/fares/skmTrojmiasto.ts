// Port of fares/skm_trojmiasto.py: PKP SKM Tricity single ticket (Taryfa Pomorska distance table).
import pkp from "../../../data/fares/pkp_intercity.json";
import table from "../../../data/fares/skm_trojmiasto.json";
import { ValueError, pyList, pyRepr, round2 } from "../pyCompat";
import { bandFor, confirmationOf } from "./bands";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;
const ULGI: Record<string, number> = pkp["ulgi_procent"];

export const STATUS_WERYFIKACJI = "wg Gemini, niezweryfikowane niezależnie";

/** Whether the amount has a second, independent source (a Gemini-only report is not enough). */
function independentlyVerified(confirmation: Table | null): boolean {
  return confirmation !== null && (confirmation["status"] ?? null) !== STATUS_WERYFIKACJI;
}

export function estimate(segment: Segment, tableOverride: Table | null = null): PriceEstimate {
  if (segment.carrier !== Carrier.SKM_TROJMIASTO) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora SKM Trójmiasto: ${segment.carrier}`);
  }
  if (segment.distance_km === null) throw new ValueError("SKM Trójmiasto: distance_km jest wymagane");
  const tbl = tableOverride ?? TABLE;

  const ulgaKod = segment.discounts.pkp_ulga_kod;
  if (!Object.hasOwn(ULGI, ulgaKod)) {
    throw new ValueError(`nieznany kod ulgi: ${pyRepr(ulgaKod)}, dostępne: ${pyList(Object.keys(ULGI))}`);
  }

  const band = bandFor(tbl, segment.distance_km, "brak pasma Taryfy Pomorskiej (SKM) dla");
  const base: number = band["cena"];
  const ulgaProcent = ULGI[ulgaKod];
  // The 37/49/51% tables are in the price list; other discounts are computed as a percentage.
  const ulgiPasma: Record<string, number> = band["ulgi"] ?? {};
  const zTabeliUlg = Object.hasOwn(ulgiPasma, String(ulgaProcent));
  const amount = zTabeliUlg ? ulgiPasma[String(ulgaProcent)] : round2(base * (1 - ulgaProcent / 100));

  const confirmation = confirmationOf(band);
  const verified = independentlyVerified(confirmation) && (ulgaProcent === 0 || zTabeliUlg);
  const official = verified && segment.distance_along_track;
  const breakdown: Record<string, unknown> = {
    cena_bazowa: base,
    pasmo_do_km: band["do_km"],
    ulga_kod: ulgaKod,
    ulga_procent: ulgaProcent,
    klasa: tbl["klasa"],
    price_verified: verified,
    odleglosc_taryfowa: segment.distance_along_track ? "po torach" : "linia prosta",
    status_weryfikacji: STATUS_WERYFIKACJI,
    obowiazuje_od: tbl["obowiazuje_od"],
  };
  let notes =
    "Bilet jednorazowy PKP SKM w Trójmieście wg tabeli odległościowej Taryfy Pomorskiej " +
    `(od ${tbl["obowiazuje_od"]}, 2. klasa), pasmo do ${band["do_km"]} km. Bilety ZTM Gdańsk ` +
    "i ZKM Gdynia nie obowiązują w SKM.";
  if (confirmation !== null) {
    breakdown["zrodlo_url"] = confirmation["zrodlo_url"];
    breakdown["data_weryfikacji"] = confirmation["data"];
    notes += ` Kwota pasma ${STATUS_WERYFIKACJI}: ${confirmation["zrodlo_url"]} (${confirmation["data"]}).`;
  } else {
    notes += " Cena NIEPOTWIERDZONA: pasmo bez źródła w pliku danych.";
  }
  if (!segment.distance_along_track) {
    notes +=
      " Pasmo dobrane z odległości w linii prostej, nie z km po torach — cena przybliżona " +
      "(rzeczywiste pasmo może być wyższe).";
  }
  if (ulgaProcent && !zTabeliUlg) {
    notes += ` Ulga ${ulgaProcent}% policzona procentem od ceny bazowej (brak jej w tabelach ulg).`;
  }
  if (!verified) {
    let reason: string;
    if (confirmation === null) reason = "pasmo niepotwierdzone w źródle pierwotnym";
    else if (!independentlyVerified(confirmation)) {
      reason = "kwota tylko z raportu Gemini, bez drugiego niezależnego źródła";
    } else reason = "ulga policzona procentem, nie z tabeli ulg";
    breakdown["powod_szacunku"] = reason;
  }

  return {
    carrier: Carrier.SKM_TROJMIASTO,
    amount,
    currency: tbl["waluta"],
    price_type: official ? PriceType.OFFICIAL : PriceType.ESTIMATE,
    breakdown,
    notes,
  };
}
