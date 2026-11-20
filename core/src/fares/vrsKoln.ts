// Port of fares/kvb.py: VRS/Rheinlandtarif (Cologne) Preisstufe 1b.
import table from "../../../data/fares/vrs_koln.json";
import { ValueError } from "../pyCompat";
import { bezplatneDziecko, dzieckoPonizej6 } from "./dzieciDo6";
import { wertmarkeFree } from "./germanLocal";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;
const POZIOMY: Record<string, Table> = Object.fromEntries(
  (TABLE["poziomy_cenowe"] as Table[]).map((p) => [p["poziom"], p]),
);
const DOMYSLNY = POZIOMY[TABLE["poziom_uzywany_domyslnie"]];

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.VRS_KOLN) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora VRS/Köln: ${segment.carrier}`);
  }
  if (dzieckoPonizej6(segment)) return bezplatneDziecko(segment, TABLE);
  if (segment.discounts.schwerbehinderte_wertmarke_de) {
    return wertmarkeFree(segment, TABLE, Carrier.VRS_KOLN, "VRS/KVB");
  }

  const dziecko = segment.discounts.vrs_koln_dziecko;
  return {
    carrier: Carrier.VRS_KOLN,
    amount: dziecko ? DOMYSLNY["dziecko"] : DOMYSLNY["normalny"],
    currency: TABLE["waluta"],
    price_type: PriceType.OFFICIAL,
    breakdown: {
      relacja: `${segment.origin} <-> ${segment.destination}`,
      typ_biletu: dziecko ? "Einzelticket dziecko" : "Einzelticket normalny",
      poziom_cenowy: DOMYSLNY["poziom"],
      zrodlo_url: TABLE["zrodlo_url"] ?? null,
      data_weryfikacji: TABLE["data_weryfikacji"] ?? null,
    },
    notes:
      "Taryfa VRS/Rheinlandtarif: Preisstufe 1b (przejazd w obrębie Kolonii lub Bonn), " +
      "Kindertarif 6-14 lat, dzieci do 6 lat jeżdżą bezpłatnie (poza zakresem tego pola " +
      "— patrz data/fares/vrs_koln.json). Dla relacji wychodzących poza miasto (Preisstufe " +
      "2a i wyżej) rzeczywista cena jest wyższa — patrz pełna tabela w " +
      "data/fares/vrs_koln.json.",
  };
}
