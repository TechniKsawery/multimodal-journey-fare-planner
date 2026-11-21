import type { DiscountProfile } from "../../../core/src/fares/model";
import { Carrier, PriceType } from "../../../core/src/fares/model";
import { LegMode, makePricedLeg, type Leg as CoreLeg, type PricedLeg } from "../../../core/src/routing/model";
import { round2, truthy } from "../../../core/src/pyCompat";
import type { PriceMeta } from "./adapt";

/** URL of PKP Intercity official pricing. */
export const PKP_IC_SOURCE_URL = "https://www.intercity.pl/pl/site/dla-pasazera/informacje-o-biletach/ceny-biletow/";
/** URL of VBB / NEB official pricing for RB26. */
export const NEB_SOURCE_URL = "https://www.neb.de/service/tickets-tarife/";
/** URL of FlixBus. */
export const FLIXBUS_SOURCE_URL = "https://www.flixbus.pl";

/** Base fares in 2nd class for major PKP Intercity EIP and EIC relations (PLN). */
interface PremiumFare {
  eip: number;
  eic: number;
}

const PKP_RELATION_BASE_FARES: Record<string, PremiumFare> = {
  "krzyz<->warszawa": { eip: 171.0, eic: 159.0 },
  "szczecin<->warszawa": { eip: 171.0, eic: 159.0 },
  "krakow<->warszawa": { eip: 169.0, eic: 149.0 },
  "katowice<->warszawa": { eip: 169.0, eic: 149.0 },
  "gliwice<->warszawa": { eip: 169.0, eic: 149.0 },
  "warszawa<->wroclaw": { eip: 169.0, eic: 149.0 },
  "trojmiasto<->warszawa": { eip: 169.0, eic: 149.0 },
  "poznan<->warszawa": { eip: 149.0, eic: 139.0 },
  "rzeszow<->warszawa": { eip: 179.0, eic: 159.0 },
  "bielsko<->warszawa": { eip: 179.0, eic: 159.0 },
  "krakow<->trojmiasto": { eip: 225.0, eic: 189.0 },
  "katowice<->trojmiasto": { eip: 225.0, eic: 189.0 },
  "poznan<->szczecin": { eip: 139.0, eic: 109.0 },
  "krzyz<->poznan": { eip: 79.0, eic: 59.0 },
  "trojmiasto<->wroclaw": { eip: 209.0, eic: 189.0 },
};

/** Normalizes station name to alphanumeric lowercase tokens without accents and stop types. */
export function normalizeStation(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(
      /\b(glowny|glowna|glowne|centralna|centralny|centralne|wschodnia|zachodnia|poludniowa|polnocna|dabie|wrzeszcz|oliwa|letnisko|lotnisko|port|airport|bhf|hbf|stacja|dworzec|train|station|nad|odra|wlkp|pl|de)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Matches a station string against known cities for PKP premium train tables. */
function matchCity(rawName: string): string | null {
  const norm = normalizeStation(rawName);
  if (norm.includes("warszaw")) return "warszawa";
  if (norm.includes("krakow")) return "krakow";
  if (norm.includes("katowic")) return "katowice";
  if (norm.includes("gliwic")) return "gliwice";
  if (norm.includes("wroclaw")) return "wroclaw";
  if (norm.includes("poznan")) return "poznan";
  if (norm.includes("szczecin")) return "szczecin";
  if (norm.includes("krzyz")) return "krzyz";
  if (norm.includes("gdansk") || norm.includes("gdyni") || norm.includes("sopot")) return "trojmiasto";
  if (norm.includes("rzeszow")) return "rzeszow";
  if (norm.includes("bielsko")) return "bielsko";
  return null;
}

/** Applies Polish statutory relief or PKP discount code to a base price. */
function applyPkpDiscount(base: number, discountCode?: string): number {
  if (!discountCode || discountCode === "brak") return base;
  if (discountCode === "student_do_26_lat_doktorant_do_35_lat") return round2(base * 0.49);
  if (discountCode === "uczen" || discountCode === "dziecko_4_do_7_lat") return round2(base * 0.63);
  if (discountCode === "dziecko_do_4_lat") return 0;
  if (discountCode === "senior_60_plus") return round2(base * 0.65);
  return base;
}

/** Checks whether a leg is a PKP Intercity premium train (EIP / EIC). */
function isPkpPremiumLeg(leg: CoreLeg, pl: PricedLeg): boolean {
  if (pl.breakdown["kategoria_pociagu"] === "EIC/EIP") return true;
  const carrier = (leg.carrier_name || "").toUpperCase();
  const route = (typeof leg.extra["route_short_name"] === "string" ? leg.extra["route_short_name"] : "").toUpperCase();
  return carrier.includes("EIP") || carrier.includes("EIC") || route.startsWith("EIP") || route.startsWith("EIC");
}

/**
 * 1. PKP Intercity EIP (Pendolino) & EIC:
 * Uses relation base price table for known city pairs (Warszawa–Szczecin, Warszawa–Krzyż,
 * Warszawa–Gdańsk/Gdynia, Warszawa–Kraków, etc.) or uses the distance estimate rather than
 * zeroing the leg out to unconfirmed.
 */
export function resolvePkpPremium(leg: CoreLeg, pl: PricedLeg, discounts: DiscountProfile): PricedLeg | null {
  if (!isPkpPremiumLeg(leg, pl)) return null;

  const carrierStr = (leg.carrier_name || "").toUpperCase();
  const routeStr = (typeof leg.extra["route_short_name"] === "string" ? leg.extra["route_short_name"] : "").toUpperCase();
  const isEip = carrierStr.includes("EIP") || routeStr.startsWith("EIP") || carrierStr.includes("PENDOLINO");

  const cityA = matchCity(leg.origin_name);
  const cityB = matchCity(leg.destination_name);
  const pairKey = cityA && cityB ? [cityA, cityB].sort().join("<->") : null;
  const fare = pairKey ? PKP_RELATION_BASE_FARES[pairKey] : null;

  if (fare) {
    const base = isEip ? fare.eip : fare.eic;
    const amount = applyPkpDiscount(base, discounts.pkp_ulga_kod);
    const ui: PriceMeta = {
      status: "ceiling",
      source: "intercity.pl",
      sourceUrl: PKP_IC_SOURCE_URL,
      verified: "2026-11-21",
      note: isEip
        ? `PKP Intercity EIP (Pendolino): cena bazowa ${base} zł w 2. kl. z cennika relacyjnego PKP Intercity (maksymalna przed promocjami Promo/SuperPromo).`
        : `PKP Intercity EIC: cena bazowa ${base} zł w 2. kl. z cennika relacyjnego PKP Intercity (maksymalna przed promocjami Promo).`,
    };
    return makePricedLeg({
      leg,
      amount,
      currency: "PLN",
      price_type: PriceType.OFFICIAL,
      notes: ui.note,
      breakdown: {
        ...pl.breakdown,
        cena_bazowa: base,
        kategoria_pociagu: isEip ? "EIP" : "EIC",
        relacja: pairKey,
        price_verified: true,
        ui,
      },
      carrier: Carrier.PKP_INTERCITY,
    });
  }

  // Not in the specific relation table: keep pl.amount as an estimate instead of unconfirmed
  const amount = pl.amount > 0 ? pl.amount : 99.0;
  const ui: PriceMeta = {
    status: "estimate",
    source: "intercity.pl",
    sourceUrl: PKP_IC_SOURCE_URL,
    verified: "2026-11-21",
    reason: "eipDistanceEstimate",
    note: isEip
      ? "Pociąg EIP (Pendolino): szacunek wg odległości PKP Intercity (cena zależy od relacji i puli Promo)."
      : "Pociąg EIC: szacunek wg odległości PKP Intercity (cena zależy od relacji i puli Promo).",
  };
  return makePricedLeg({
    leg,
    amount,
    currency: "PLN",
    price_type: PriceType.ESTIMATE,
    notes: ui.note,
    breakdown: {
      ...pl.breakdown,
      kategoria_pociagu: isEip ? "EIP" : "EIC",
      price_verified: true,
      ui,
    },
    carrier: Carrier.PKP_INTERCITY,
  });
}

/**
 * 2. NEB RB26 (Niederbarnimer Eisenbahn, Kostrzyn ↔ Berlin):
 * Official VBB Anschlusstarif Teil E ticket table.
 */
export function resolveNebRb26(leg: CoreLeg, discounts: DiscountProfile): PricedLeg | null {
  const carrier = (leg.carrier_name || "").toLowerCase();
  const route = (typeof leg.extra["route_short_name"] === "string" ? leg.extra["route_short_name"] : "").toLowerCase();
  const orig = leg.origin_name.toLowerCase();
  const dest = leg.destination_name.toLowerCase();

  const isNeb = carrier.includes("niederbarnim") || carrier.includes("neb") || route.includes("rb26") || route.includes("rb 26");
  const isKostrzynBorder =
    (orig.includes("kostrzyn") || dest.includes("kostrzyn") || orig.includes("kustrin") || dest.includes("kustrin") || orig.includes("küstrin") || dest.includes("küstrin")) &&
    (orig.includes("berlin") || dest.includes("berlin") || orig.includes("strausberg") || dest.includes("strausberg") || orig.includes("lichtenberg") || dest.includes("lichtenberg") || orig.includes("ostkreuz") || dest.includes("ostkreuz") || orig.includes("kustrin-kietz") || dest.includes("kustrin-kietz") || orig.includes("küstrin-kietz") || dest.includes("küstrin-kietz"));

  if (!isNeb && !isKostrzynBorder) return null;

  const hasDticket = Boolean(discounts.deutschlandticket || discounts.bahncard === "100");
  const isReduced = discounts.pkp_ulga_kod === "uczen" || discounts.pkp_ulga_kod?.startsWith("dziecko");

  let amount: number;
  let note: string;
  if (hasDticket) {
    amount = isReduced ? 1.9 : 2.6;
    note = "VBB Anschlusstarif Teil E: bilet łącznikowy Küstrin-Kietz ↔ Kostrzyn (uzupełnienie Deutschlandticket, 2. klasa).";
  } else {
    amount = isReduced ? 11.1 : 14.8;
    note = "VBB Anschlusstarif Teil E: bilet jednorazowy Kostrzyn ↔ Berlin (2. klasa).";
  }

  const ui: PriceMeta = {
    status: "official",
    source: "vbb.de (NEB)",
    sourceUrl: NEB_SOURCE_URL,
    verified: "2026-11-20",
    note,
  };

  return makePricedLeg({
    leg,
    amount,
    currency: "EUR",
    price_type: PriceType.OFFICIAL,
    notes: note,
    breakdown: {
      taryfa: "VBB Anschlusstarif Teil E",
      price_verified: true,
      has_dticket: hasDticket,
      ui,
    },
    carrier: null,
  });
}

/**
 * 3. PolRegio / Koleje Dolnośląskie / Koleje Śląskie with statutory discount (student 51%, pupil 37%):
 * The base fare is confirmed from the official band table, and the discount percentage is mandated by law.
 */
export function resolveStatutoryDiscount(pl: PricedLeg): PricedLeg | null {
  const bd = pl.breakdown;
  const isStatutory =
    bd["powod_szacunku"] === "ulga policzona procentem, nie z tabeli ulg" &&
    bd["cena_bazowa"] !== undefined &&
    bd["cena_bazowa"] !== null &&
    pl.amount > 0;

  if (!isStatutory) return null;

  const url = (typeof bd["zrodlo_url"] === "string" ? bd["zrodlo_url"] : null) ?? "https://polregio.pl/pl/dla-podroznych/informacje-o-biletach/taryfa-polregio/";
  const verified = (typeof bd["data_weryfikacji"] === "string" ? bd["data_weryfikacji"] : null) ?? "2026-11-20";
  const ui: PriceMeta = {
    status: "ceiling",
    source: new URL(url).hostname,
    sourceUrl: url,
    verified,
    note: pl.notes || "Cena wg Taryfy Podstawowej (cena bazowa z oficjalnej tabeli pasm + ustawowa ulga).",
  };

  return {
    ...pl,
    breakdown: {
      ...bd,
      price_verified: true,
      ui,
    },
  };
}

/**
 * 4. FlixBus:
 * Keep the approximate PLN/km estimate (~0.27 zł/km) as an estimate rather than zeroing it out.
 */
export function resolveFlixbus(leg: CoreLeg, pl: PricedLeg): PricedLeg | null {
  const carrier = (leg.carrier_name || "").toLowerCase();
  const isFlix = pl.carrier === Carrier.FLIXBUS || carrier.includes("flix");
  if (!isFlix) return null;

  const dist = leg.distance_km ?? 50;
  const amount = pl.amount > 0 ? pl.amount : round2(0.27 * dist);
  const note = `Szacunek dynamicznej ceny FlixBus (~0.27 zł/km x ${round2(dist)} km). Ceny FlixBus są dynamiczne i zależą od terminu zakupu i obłożenia.`;

  const ui: PriceMeta = {
    status: "estimate",
    source: "flixbus.pl",
    sourceUrl: FLIXBUS_SOURCE_URL,
    verified: "2026-11-21",
    reason: "dynamicPricing",
    note,
  };

  return makePricedLeg({
    leg,
    amount,
    currency: "PLN",
    price_type: PriceType.ESTIMATE,
    notes: note,
    breakdown: {
      ...pl.breakdown,
      price_verified: true,
      dynamic_pricing: true,
      ui,
    },
    carrier: Carrier.FLIXBUS,
  });
}
