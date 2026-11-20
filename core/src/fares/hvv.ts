// Port of fares/hvv.py: HVV (Hamburg) Einzelkarte of the lowest zone (1-2 Ringe / Hamburg AB).
import table from "../../../data/fares/hvv.json";
import { ValueError } from "../pyCompat";
import { bezplatneDziecko, dzieckoPonizej6 } from "./dzieciDo6";
import { wertmarkeFree } from "./germanLocal";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.HVV) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora HVV: ${segment.carrier}`);
  }
  if (dzieckoPonizej6(segment)) return bezplatneDziecko(segment, TABLE);
  if (segment.discounts.schwerbehinderte_wertmarke_de) {
    return wertmarkeFree(segment, TABLE, Carrier.HVV, "HVV");
  }

  const dziecko = segment.discounts.hvv_dziecko;
  const bilet = TABLE["einzelkarte_najnizsza_strefa"];
  return {
    carrier: Carrier.HVV,
    amount: dziecko ? bilet["dziecko"] : bilet["normalny"],
    currency: TABLE["waluta"],
    price_type: PriceType.OFFICIAL,
    breakdown: {
      relacja: `${segment.origin} <-> ${segment.destination}`,
      typ_biletu: dziecko ? "Einzelkarte dziecko" : "Einzelkarte normalny",
      strefa: "1-2 Ringe / Hamburg AB (przybliżenie najniższej strefy)",
      zrodlo_url: TABLE["zrodlo_url"] ?? null,
      data_weryfikacji: TABLE["data_weryfikacji"] ?? null,
    },
    notes:
      "Taryfa HVV (Tarifstand 01.01.2026): Einzelkarte najniższej strefy (1-2 Ringe / " +
      "Hamburg AB). Kindertarif 6-14 lat (dzieci do 6 lat jeżdżą bezpłatnie, poza " +
      "zakresem tego pola — patrz data/fares/hvv.json). Brak mapowania przystanek->Ring " +
      "— relacje obejmujące więcej Ringów są w rzeczywistości droższe niż ten wynik " +
      "(patrz pełna tabela stref w data/fares/hvv.json).",
  };
}
