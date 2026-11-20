// Port of fares/mvv.py: MVV (Munich) Einzelkarte Zone M.
import table from "../../../data/fares/mvv.json";
import { ValueError } from "../pyCompat";
import { bezplatneDziecko, dzieckoPonizej6 } from "./dzieciDo6";
import { wertmarkeFree } from "./germanLocal";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.MVV) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora MVV: ${segment.carrier}`);
  }
  if (dzieckoPonizej6(segment)) return bezplatneDziecko(segment, TABLE);
  if (segment.discounts.schwerbehinderte_wertmarke_de) {
    return wertmarkeFree(segment, TABLE, Carrier.MVV, "MVV");
  }

  const dziecko = segment.discounts.mvv_dziecko;
  const bilet = TABLE["einzelkarte_zone_m"];
  return {
    carrier: Carrier.MVV,
    amount: dziecko ? bilet["dziecko"] : bilet["normalny"],
    currency: TABLE["waluta"],
    price_type: PriceType.OFFICIAL,
    breakdown: {
      relacja: `${segment.origin} <-> ${segment.destination}`,
      typ_biletu: dziecko ? "Einzelkarte dziecko" : "Einzelkarte normalny",
      strefa: "Zone M (przybliżenie najniższej strefy)",
      zrodlo_url: TABLE["zrodlo_url"] ?? null,
      data_weryfikacji: TABLE["data_weryfikacji"] ?? null,
    },
    notes:
      "Taryfa MVV (ceny od 01.01.2026): Einzelkarte Zone M. Kindertarif 6-14 lat (dzieci " +
      "do 6 lat jeżdżą bezpłatnie, poza zakresem tego pola — patrz data/fares/mvv.json). " +
      "Brak mapowania przystanek->strefa — relacje wychodzące poza Zone M (strefy 1-12) " +
      "są w rzeczywistości droższe niż ten wynik.",
  };
}
