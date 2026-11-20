// Port of fares/mpk_wroclaw.py: MPK Wrocław time tariff.
import table from "../../../data/fares/mpk_wroclaw.json";
import { ValueError, formatFixed } from "../pyCompat";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";
import { pickTicket, sortedTickets } from "./timed";

const TABLE: Table = table;
const BILETY = sortedTickets(TABLE);
const NAJDLUZSZY = BILETY[BILETY.length - 1];

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.MPK_WROCLAW) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora MPK Wrocław: ${segment.carrier}`);
  }
  if (segment.ride_duration_min === null) {
    throw new ValueError("MPK Wrocław (taryfa czasowa): ride_duration_min jest wymagane");
  }
  const duration = segment.ride_duration_min;
  const bilet = pickTicket(BILETY, duration);
  let amount: number;
  let typBiletu: string;
  if (segment.discounts.mpk_wroclaw_bezplatny) {
    amount = 0.0;
    typBiletu = "bezpłatny (100%)";
  } else if (segment.discounts.mpk_wroclaw_ulgowy) {
    amount = bilet["ulgowy"];
    typBiletu = "ulgowy (50%)";
  } else {
    amount = bilet["normalny"];
    typBiletu = "normalny";
  }
  const przekroczono = duration > NAJDLUZSZY["wazny_min"];

  return {
    carrier: Carrier.MPK_WROCLAW,
    amount,
    currency: TABLE["waluta"],
    price_type: przekroczono ? PriceType.ESTIMATE : PriceType.OFFICIAL,
    breakdown: {
      relacja: `${segment.origin} <-> ${segment.destination}`,
      czas_jazdy_min: duration,
      bilet_wazny_min: bilet["wazny_min"],
      typ_biletu: typBiletu,
      strefa: bilet["strefa"] ?? "miejska",
      zrodlo_url: TABLE["zrodlo_url"] ?? null,
      data_weryfikacji: TABLE["data_weryfikacji"] ?? null,
    },
    notes:
      `Taryfa czasowa MPK Wrocław (${TABLE["nazwa_przewoznika"]}): dobrano ` +
      `bilet ${bilet["wazny_min"]}-minutowy.` +
      (przekroczono
        ? ` Czas jazdy (${formatFixed(duration, 0)} min) przekracza najdłuższy dostępny ` +
          `bilet (${NAJDLUZSZY["wazny_min"]} min) — cena to szacunek.`
        : ""),
  };
}
