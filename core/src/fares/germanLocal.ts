// Shared by hvv.ts / mvv.ts / vrsKoln.ts: nationwide free travel with a Wertmarke (§ 228 SGB IX).
import { PriceType, type Carrier, type PriceEstimate, type Segment, type Table } from "./model";

export function wertmarkeFree(segment: Segment, table: Table, carrier: Carrier, network: string): PriceEstimate {
  return {
    carrier,
    amount: 0.0,
    currency: table["waluta"],
    price_type: PriceType.OFFICIAL,
    breakdown: {
      relacja: `${segment.origin} <-> ${segment.destination}`,
      typ_biletu: "bezpłatny (Schwerbehinderte, Wertmarke)",
      zrodlo_url: table["zrodlo_url"] ?? null,
      data_weryfikacji: table["data_weryfikacji"] ?? null,
    },
    notes:
      "Bezpłatny przejazd dla osób z ciężką niepełnosprawnością z ważną Wertmarke " +
      "w legitymacji (§ 228 SGB IX) — zasada ogólnoniemiecka, dotyczy identycznie " +
      `całego lokalnego transportu ${network}.`,
  };
}
