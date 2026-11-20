// Port of fares/lka_lodz.py: ŁKA zone A tickets (20/40/80 min). Amounts come only from a Gemini
// report until a second independent source exists -> price_verified=false / estimate.
import table from "../../../data/fares/lka_lodz.json";
import { ValueError, formatFixed } from "../pyCompat";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";
import { pickTicket, sortedTickets } from "./timed";

const TABLE: Table = table;
const BILETY = sortedTickets(TABLE);
const NAJDLUZSZY = BILETY[BILETY.length - 1];

export const STATUS_WERYFIKACJI = "wg Gemini, niezweryfikowane niezależnie";

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.LKA_LODZ) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora ŁKA: ${segment.carrier}`);
  }
  if (segment.ride_duration_min === null) {
    throw new ValueError("ŁKA (taryfa czasowa): ride_duration_min jest wymagane");
  }
  const duration = segment.ride_duration_min;
  const bilet = pickTicket(BILETY, duration);
  const przekroczono = duration > NAJDLUZSZY["wazny_min"];
  const ulgaWnioskowana = segment.discounts.pkp_ulga_kod !== "brak";
  const niezaleznieZweryfikowane = TABLE["weryfikacja"]["status"] !== STATUS_WERYFIKACJI;
  // ŁKA/MPK Łódź discounts are not modelled: a passenger with a discount gets the full price,
  // flagged unconfirmed so the ranking does not treat it as read from the price list.
  const verified = niezaleznieZweryfikowane && !ulgaWnioskowana;
  const breakdown: Record<string, unknown> = {
    relacja: `${segment.origin} <-> ${segment.destination}`,
    czas_jazdy_min: duration,
    bilet_wazny_min: bilet["wazny_min"],
    typ_biletu: "normalny",
    strefa: bilet["strefa"],
    status_weryfikacji: STATUS_WERYFIKACJI,
    price_verified: verified,
    zrodlo_url: TABLE["zrodlo_url"] ?? null,
    data_weryfikacji: TABLE["data_weryfikacji"] ?? null,
  };
  if (!verified) {
    breakdown["powod_szacunku"] = niezaleznieZweryfikowane
      ? "ulgi ŁKA/MPK Łódź nie są modelowane (cena normalna)"
      : "kwota tylko z raportu Gemini, bez drugiego niezależnego źródła";
  }
  let notes =
    `Bilet strefowy ŁKA (Strefa A, Łódź) ${bilet["wazny_min"]}-minutowy, honorowany też w MPK ` +
    `Łódź; ${STATUS_WERYFIKACJI}. Bilety z aplikacji kasuje się kodem QR; Open Payment System ` +
    "nie jest honorowany.";
  if (przekroczono) {
    notes +=
      ` Czas jazdy (${formatFixed(duration, 0)} min) przekracza najdłuższy bilet ` +
      `(${NAJDLUZSZY["wazny_min"]} min) — cena to szacunek.`;
  }
  if (!niezaleznieZweryfikowane) notes += " Cena niepotwierdzona: brak drugiego niezależnego źródła kwot.";
  if (ulgaWnioskowana) notes += " Ulgi nie są modelowane: pokazana cena normalna, niepotwierdzona dla ulgi.";

  return {
    carrier: Carrier.LKA_LODZ,
    amount: bilet["normalny"],
    currency: TABLE["waluta"],
    price_type: przekroczono || !verified ? PriceType.ESTIMATE : PriceType.OFFICIAL,
    breakdown,
    notes,
  };
}
