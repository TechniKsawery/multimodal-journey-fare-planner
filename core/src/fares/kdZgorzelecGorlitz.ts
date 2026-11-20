// Port of fares/kd_zgorzelec_gorlitz.py: free KD train on the Zgorzelec - Görlitz border section.
import table from "../../../data/fares/kd_zgorzelec_gorlitz.json";
import { ValueError } from "../pyCompat";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;

export const STATUS_WERYFIKACJI = "wg Gemini, niezweryfikowane niezależnie";

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.KD_ZGORZELEC_GORLITZ) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora KD: ${segment.carrier}`);
  }
  const weryfikacja: Table = TABLE["weryfikacja"];
  const potwierdzone = weryfikacja["status"] !== STATUS_WERYFIKACJI;
  const breakdown: Record<string, unknown> = {
    relacja: `${segment.origin} <-> ${segment.destination}`,
    status_weryfikacji: weryfikacja["status"],
    zrodlo_url: weryfikacja["url"],
    data_odczytu: weryfikacja["data_odczytu"],
    price_verified: potwierdzone,
  };
  let notes =
    "Pociąg Kolei Dolnośląskich na odcinku granicznym Zgorzelec - Görlitz: przejazd " +
    `bezpłatny (${weryfikacja["status"]}, odczyt ${weryfikacja["data_odczytu"]}).`;
  if (!potwierdzone) {
    breakdown["powod_szacunku"] = "bezpłatność tylko z raportu Gemini, bez drugiego źródła";
    notes += " Cena niepotwierdzona.";
  }
  return {
    carrier: Carrier.KD_ZGORZELEC_GORLITZ,
    amount: TABLE["cena"],
    currency: TABLE["waluta"],
    price_type: potwierdzone ? PriceType.OFFICIAL : PriceType.ESTIMATE,
    breakdown,
    notes,
  };
}
