// Port of fares/bvg_berlin.py: BVG/VBB Berlin time tariff (AB / ABC).
import table from "../../../data/fares/bvg_berlin.json";
import { ValueError, formatFixed } from "../pyCompat";
import { bezplatneDziecko, dzieckoPonizej6 } from "./dzieciDo6";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";
import { pickTicket, sortedTickets } from "./timed";

const TABLE: Table = table;
const BILETY = sortedTickets(TABLE);

/** For a leg in zone C (strefa "ABC", e.g. BER airport) only the ABC ticket is valid. */
function chooseTicket(durationMin: number, strefa: string | null): Table {
  if (strefa === "ABC") {
    const abc = BILETY.find((b) => b["strefa"] === "ABC");
    if (!abc) throw new Error("StopIteration");
    return abc;
  }
  return pickTicket(BILETY, durationMin);
}

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.BVG_BERLIN) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora BVG Berlin: ${segment.carrier}`);
  }
  if (segment.ride_duration_min === null) {
    throw new ValueError("BVG Berlin (taryfa czasowa): ride_duration_min jest wymagane");
  }
  if (dzieckoPonizej6(segment)) return bezplatneDziecko(segment, TABLE);

  const duration = segment.ride_duration_min;
  const bilet = chooseTicket(duration, segment.tariff_zone);
  const schwerbehindert = segment.discounts.bvg_berlin_schwerbehindert;
  const age = segment.discounts.age;
  const wiekUlgowy = age !== null && 6 <= age && age <= 14;
  const ulgowy = segment.discounts.bvg_berlin_ulgowy || wiekUlgowy;
  let amount: number;
  let typBiletu: string;
  if (schwerbehindert) {
    amount = 0.0;
    typBiletu = "bezpłatny (Schwerbehindertenausweis + Wertmarke)";
  } else if (ulgowy) {
    amount = bilet["ulgowy"];
    typBiletu = "ulgowy (Ermäßigungstarif)";
  } else {
    amount = bilet["normalny"];
    typBiletu = "normalny";
  }
  const przekroczono = duration > bilet["wazny_min"];

  return {
    carrier: Carrier.BVG_BERLIN,
    amount,
    currency: TABLE["waluta"],
    price_type: przekroczono ? PriceType.ESTIMATE : PriceType.OFFICIAL,
    breakdown: {
      relacja: `${segment.origin} <-> ${segment.destination}`,
      czas_jazdy_min: duration,
      bilet_wazny_min: bilet["wazny_min"],
      typ_biletu: typBiletu,
      strefa: bilet["strefa"] ?? "AB",
      zrodlo_url: TABLE["zrodlo_url"] ?? null,
      data_weryfikacji: TABLE["data_weryfikacji"] ?? null,
    },
    notes:
      `Taryfa BVG/VBB Berlin (${TABLE["nazwa_przewoznika"]}, ważna od 1.01.2026): dobrano ` +
      `bilet ${bilet["strefa"]} (ważny ${bilet["wazny_min"]} min).` +
      (segment.tariff_zone === "ABC"
        ? " Odcinek zaczyna się lub kończy w strefie C (lotnisko BER) — bilet AB tam nie " +
          "obowiązuje, potrzebny ABC."
        : "") +
      (przekroczono
        ? ` Czas jazdy (${formatFixed(duration, 0)} min) przekracza najdłuższy dostępny ` +
          `bilet (${bilet["wazny_min"]} min) — cena to szacunek.`
        : "") +
      (wiekUlgowy && !segment.discounts.bvg_berlin_ulgowy && !schwerbehindert
        ? " Taryfa ulgowa z wieku (Ermäßigungstarif 6-14 lat)."
        : ""),
  };
}
