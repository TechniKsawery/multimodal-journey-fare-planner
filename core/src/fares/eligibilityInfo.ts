// Port of fares/eligibility_info.py: verified titles to free/reduced city travel, per carrier.
// Content comes ONLY from what data/fares/*.json already confirms; nothing is guessed here.
import { Carrier } from "./model";

const WERTMARKE = "Ciężka niepełnosprawność (Merkzeichen G/aG/H/Bl/Gl) z ważną Wertmarke — § 228 SGB IX";

export type Eligibility = readonly [city: string, free: readonly string[], reduced: readonly string[], source: string];

export const ELIGIBILITY: Readonly<Partial<Record<Carrier, Eligibility>>> = {
  [Carrier.ZTM_WARSZAWA]: [
    "Warszawa",
    [
      "dzieci do 30.09 roku ukończenia 7 lat",
      "uczniowie szkół podstawowych (Karta Ucznia; ponadpodstawowe NIE)",
      "osoby 70+ (bez wymogu zamieszkania)",
      "niepełnosprawność znaczna 26+",
    ],
    [
      "dzieci od 1.10 roku ukończenia 7 lat do 16 lat",
      "studenci",
      "emeryci/renciści do 70 lat",
      "niepełnosprawność umiarkowana 26+",
    ],
    "https://www.wtp.waw.pl/ulgi-znizki/",
  ],
  [Carrier.MPK_KRAKOW]: [
    "Kraków",
    [
      "dzieci do 30.09 roku ukończenia 7 lat",
      "uczniowie szkół podstawowych z Krakowa/Metropolii (ponadpodstawowe NIE)",
      "osoby 70+ (bez wymogu zamieszkania)",
      "niepełnosprawność znaczna",
    ],
    ["dzieci od 1.10 roku ukończenia 7 lat do 16 lat"],
    "https://ztp.krakow.pl/kmk/przewodnik-po-biletach-kmk",
  ],
  [Carrier.MPK_WROCLAW]: [
    "Wrocław",
    [
      "uczniowie szkół podstawowych i ponadpodstawowych do 21 lat",
      "dzieci do 7 lat",
      "seniorzy 65+ (bez wymogu zamieszkania)",
    ],
    ["studenci i doktoranci", "uczniowie szkół policealnych"],
    "https://www.wroclaw.pl/komunikacja/uprawnienia-do-ulg",
  ],
  [Carrier.ZTM_LUBLIN]: [
    "Lublin",
    [
      "dzieci do 30.09 roku ukończenia 7 lat",
      "uczniowie szkół podstawowych (gmina Lublin; ponadpodstawowe NIE)",
      "osoby 65+",
    ],
    [
      "uczniowie podstawowych/ponadpodstawowych/policealnych do 24 lat",
      "doktoranci",
      "uczniowie i studenci szkół zagranicznych do 26 lat z kartą ISIC",
      "emeryci",
    ],
    "https://zdtm.lublin.eu/pl/ulgi-w-przejazdach/33.html",
  ],
  [Carrier.ZTM_POZNAN]: [
    "Poznań",
    [
      "dzieci do 30.09 roku ukończenia 7 lat",
      "osoby 70+ (bez wymogu zamieszkania)",
      "niepełnosprawność znaczna / I grupa",
    ],
    ["uczniowie (w Poznaniu NIE jeżdżą bezpłatnie)", "dzieci od 1.10 roku ukończenia 7 lat do 18 lat"],
    "https://www.ztm.poznan.pl/wszystko-o-biletach/ulgi-i-zwolnienia/",
  ],
  [Carrier.BVG_BERLIN]: [
    "Berlin",
    ["dzieci do 6 lat", "Schwerbehindertenausweis (G/aG/H/Bl) + osobno wykupiona Wertmarke"],
    ["dzieci 6-14 lat (Ermäßigungstarif)"],
    "https://www.vbb.de",
  ],
  [Carrier.VRR]: [
    "VRR (NRW)",
    ["dzieci do 6 lat"],
    ["dzieci 6-14 lat (Kindertarif)"],
    "https://eezy.nrw/hilfe/so-funktioniert-eezy-nrw",
  ],
  [Carrier.HVV]: ["Hamburg", [WERTMARKE, "dzieci do 6 lat"], ["dzieci 6-14 lat"], "https://www.hvv.de"],
  [Carrier.MVV]: [
    "Monachium",
    [WERTMARKE, "dzieci do 6 lat"],
    ["dzieci 6-14 lat"],
    "https://www.mvv-muenchen.de/tickets-abos-preise/einzelfahrkarte",
  ],
  [Carrier.VRS_KOLN]: [
    "Kolonia",
    [WERTMARKE, "dzieci do 6 lat"],
    [],
    "https://www.vrs.de/tickets/ticketsortiment/einzelticket",
  ],
};

/** (city, free, reduced, source) or null when the carrier has no entry. */
export function eligibilityFor(carrier: Carrier): Eligibility | null {
  return ELIGIBILITY[carrier] ?? null;
}

/** Why the price came out 0/reduced — from the calculator's `typ_biletu`; null for an ordinary price. */
export function explainTicket(breakdown: Record<string, unknown>): string | null {
  const typ = String(breakdown["typ_biletu"] ?? "");
  if (typ.startsWith("bezpłatny")) {
    return `Przejazd bezpłatny — ${typ}. Wynika z zaznaczonego tytułu w formularzu.`;
  }
  if (typ.startsWith("ulgowy") || typ.includes("dziecko")) {
    return `Bilet ulgowy — ${typ}. Wynika z zaznaczonego tytułu w formularzu.`;
  }
  return null;
}
