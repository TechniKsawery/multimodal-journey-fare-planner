// Port of fares/vrr.py: eezy.nrw price = Grundpreis + price/km x straight-line distance, capped.
import table from "../../../data/fares/vrr_eezy.json";
import { ValueError, round2 } from "../pyCompat";
import { bezplatneDziecko, dzieckoPonizej6 } from "./dzieciDo6";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.VRR) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora VRR: ${segment.carrier}`);
  }
  if (dzieckoPonizej6(segment)) return bezplatneDziecko(segment, TABLE);
  if (segment.distance_km === null) {
    throw new ValueError("VRR (eezy.nrw): distance_km jest wymagane (odległość w linii prostej)");
  }

  const surowaCena = TABLE["grundpreis"] + TABLE["cena_za_km"] * segment.distance_km;
  const sufit: number = TABLE["sufity_cenowe_einzelticket"][TABLE["sufit_uzywany_domyslnie"]];
  let amount = round2(Math.min(surowaCena, sufit));

  const age = segment.discounts.age;
  const wiekDziecko = age !== null && 6 <= age && age <= 14;
  const dziecko = segment.discounts.vrr_dziecko || wiekDziecko;
  if (dziecko) amount = round2(amount * (1 - TABLE["kindertarif_rabat_procent"] / 100));

  return {
    carrier: Carrier.VRR,
    amount,
    currency: TABLE["waluta"],
    price_type: PriceType.OFFICIAL,
    breakdown: {
      relacja: `${segment.origin} <-> ${segment.destination}`,
      grundpreis: TABLE["grundpreis"],
      cena_za_km: TABLE["cena_za_km"],
      odleglosc_km: segment.distance_km,
      cena_przed_sufitem: round2(surowaCena),
      sufit_cenowy: sufit,
      sufit_zastosowany: surowaCena > sufit,
      kindertarif: dziecko,
      zrodlo_url: TABLE["zrodlo_url"] ?? null,
      data_weryfikacji: TABLE["data_weryfikacji"] ?? null,
    },
    notes:
      "Taryfa eezy.nrw (oficjalna, Stand 01.06.2026): Grundpreis + cena za km linii " +
      "prostej, ograniczona sufitem ceny EinzelTicket dla najwyższej strefy sieciowej " +
      "(Preisstufe C) — rzeczywisty sufit dla krótszych relacji może być niższy " +
      "(Preisstufe A/B), patrz data/fares/vrr_eezy.json." +
      (dziecko
        ? ` Zastosowano Kindertarif: ${TABLE["kindertarif_rabat_procent"]}% rabatu ` +
          "(dzieci 6-14 lat, oficjalny, wliczając sufit cenowy)."
        : ""),
  };
}
