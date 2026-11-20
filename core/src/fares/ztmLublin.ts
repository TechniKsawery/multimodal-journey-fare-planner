// Port of fares/ztm_lublin.py: ZTM Lublin time tariff (zone 1+2), with free/reduced rules from age.
import table from "../../../data/fares/ztm_lublin.json";
import { ValueError, formatFixed, parseIsoDate } from "../pyCompat";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";
import { pickTicket, sortedTickets } from "./timed";

const TABLE: Table = table;
const BILETY = sortedTickets(TABLE);
const NAJDLUZSZY = BILETY[BILETY.length - 1];
const BEZPLATNE: Table = TABLE["bezplatne"];
const ZRODLO: string = TABLE["source_url"];
const DATA: string = TABLE["verified_date"];

/** Free-travel title that follows from age alone (null = age gives no free travel). */
function powodBezplatny(segment: Segment): string | null {
  const age = segment.discounts.age;
  if (age === null) return null;
  if (age >= BEZPLATNE["senior_od_wieku"]) return `osoba ${BEZPLATNE["senior_od_wieku"]}+`;
  const limit: number = BEZPLATNE["dzieci_do_wieku"];
  if (age < limit - 1) return `dziecko do 30.09 roku ukończenia ${limit} lat`;
  if (age === limit - 1 && segment.travel_date) {
    const d = parseIsoDate(segment.travel_date);
    if (d.month < 9 || (d.month === 9 && d.day <= 30)) return `dziecko do 30.09 roku ukończenia ${limit} lat`;
  }
  const [lo, hi] = BEZPLATNE["uczniowie_podstawowek_zakladany_wiek"] as [number, number];
  if (lo <= age && age <= hi) {
    return "uczeń szkoły podstawowej w Lublinie (założony z wieku, wymaga legitymacji szkolnej)";
  }
  return null;
}

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.ZTM_LUBLIN) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora ZTM Lublin: ${segment.carrier}`);
  }
  if (segment.ride_duration_min === null) {
    throw new ValueError("ZTM Lublin (taryfa czasowa): ride_duration_min jest wymagane");
  }
  const duration = segment.ride_duration_min;
  const bilet = pickTicket(BILETY, duration);
  const powod = powodBezplatny(segment);
  const bezplatny = segment.discounts.ztm_lublin_bezplatny || powod !== null;
  const ulgowy = segment.discounts.ztm_lublin_ulgowy;
  let amount: number;
  let typBiletu: string;
  if (bezplatny) {
    amount = 0.0;
    typBiletu = "bezpłatny (100%)";
  } else if (ulgowy) {
    amount = bilet["ulgowy"];
    typBiletu = "ulgowy";
  } else {
    amount = bilet["normalny"];
    typBiletu = "normalny";
  }
  const przekroczono = duration > NAJDLUZSZY["wazny_min"];
  const fromAge = !!powod && !segment.discounts.ztm_lublin_bezplatny;

  return {
    carrier: Carrier.ZTM_LUBLIN,
    amount,
    currency: TABLE["waluta"],
    price_type: przekroczono ? PriceType.ESTIMATE : PriceType.OFFICIAL,
    breakdown: {
      relacja: `${segment.origin} <-> ${segment.destination}`,
      czas_jazdy_min: duration,
      bilet_wazny_min: bilet["wazny_min"],
      typ_biletu: typBiletu,
      strefa: "1+2",
      price_verified: true,
      zrodlo: ZRODLO,
      data_weryfikacji: DATA,
      ...(fromAge ? { powod_bezplatny: powod } : {}),
    },
    notes:
      "Taryfa czasowa ZTM Lublin (oficjalna, strefa 1+2, ważna od 16.02.2026, " +
      `zweryfikowano ${DATA}: ${ZRODLO}): dobrano ` +
      `bilet ${bilet["wazny_min"]}-minutowy jako najkrótszy pokrywający czas jazdy.` +
      (fromAge ? ` Przejazd bezpłatny z wieku: ${powod}.` : "") +
      (przekroczono
        ? ` Czas jazdy (${formatFixed(duration, 0)} min) przekracza najdłuższy dostępny ` +
          `bilet (${NAJDLUZSZY["wazny_min"]} min) — cena to szacunek (ekstrapolacja).`
        : ""),
  };
}
