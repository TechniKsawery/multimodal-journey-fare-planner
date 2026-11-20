// Port of fares/_dzieci_do_6.py: free travel for children under 6 in HVV/MVV/VRS/BVG/VRR.
import { PriceType, type PriceEstimate, type Segment, type Table } from "./model";

export const WIEK_GRANICA = 6;

export function dzieckoPonizej6(segment: Segment): boolean {
  const age = segment.discounts.age;
  return age !== null && age < WIEK_GRANICA;
}

export function bezplatneDziecko(segment: Segment, tabela: Table): PriceEstimate {
  const regula = tabela["dzieci_ponizej_6_lat_bezplatnie"];
  return {
    carrier: segment.carrier,
    amount: 0.0,
    currency: tabela["waluta"],
    price_type: PriceType.OFFICIAL,
    breakdown: {
      relacja: `${segment.origin} <-> ${segment.destination}`,
      typ_biletu: "bezpłatny (dziecko poniżej 6 lat)",
      zrodlo_url: regula["zrodlo_url"] ?? null,
      data_weryfikacji: regula["data_weryfikacji"] ?? null,
    },
    notes:
      `Dziecko poniżej 6 lat jedzie bezpłatnie. Warunek: ${regula["warunek"]} ` +
      `Źródło: ${regula["zrodlo_url"]} (zweryfikowano ${regula["data_weryfikacji"]}).`,
  };
}
