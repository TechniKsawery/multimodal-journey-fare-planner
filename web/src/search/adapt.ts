// Transitous itineraries -> priced, ranked itineraries for the UI.
// Routing comes from the public Transitous API; prices, transfer safety and the "cheapest / fastest /
// safest" tags come from core/ (the TypeScript port of the Python oracle).
import { truthy } from "../../../core/src/pyCompat";
import type { DiscountProfile } from "../../../core/src/fares/model";
import {
  LegMode,
  isInfeasible,
  makePricedLeg,
  priceKnown,
  priceStatus,
  type Itinerary as CoreItinerary,
  type Leg as CoreLeg,
  type PricedLeg,
} from "../../../core/src/routing/model";
import { itineraryToLegs, type Raw } from "../../../core/src/routing/motis";
import { priceLeg as corePriceLeg } from "../../../core/src/routing/pricing";
import { buildItinerary, pickRecommendations } from "../../../core/src/routing/scoring";
import type { Itinerary, Leg, Mode, PriceStatus, Profile, Transfer } from "../types";
import { toDiscountProfile } from "./profile";

// Raw Transitous (MOTIS v6) itinerary/leg: only what this adapter reads.
interface TPlace { name: string; lat: number; lon: number; tz?: string }
interface TLeg { mode: string; from: TPlace; to: TPlace; startTime: string; endTime: string; agencyName?: string | null; routeShortName?: string | null }
interface TItinerary { startTime: string; endTime: string; legs: TLeg[] }

const RAIL_MODES = new Set(["HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_FAST_RAIL", "REGIONAL_RAIL", "RAIL"]);
const SOURCE_LABELS: Record<string, string> = {
  international_pl_de: "Taryfa PL–DE (bahn.de, cena od)",
};
const DB_SOURCE_URL = "https://www.bahn.de/faq/pk/angebot/flexpreis";

/** How a leg was priced, for the UI. Lives in breakdown.ui so it survives core/ scoring. */
export interface PriceMeta {
  status: PriceStatus;
  source?: string;
  sourceUrl?: string;
  verified?: string;
  reason?: string;
  note?: string;
}

/** UI warning threshold for a short transfer (minutes). */
export const SHORT_TRANSFER_UI_MIN = 10;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Unconfirmed = no amount (unknown price, a km-rate fallback or a placeholder): never summed. */
function unconfirmed(leg: CoreLeg, reason: string, note?: string): PricedLeg {
  const ui: PriceMeta = { status: "unconfirmed", reason, note };
  return makePricedLeg({ leg, amount: 0, currency: "PLN", price_type: "szacunek", breakdown: { cena_nieznana: true, price_verified: false, ui } });
}

/** Prices one leg with core/ and classifies the result (official / estimate / unconfirmed). */
export function priceOne(leg: CoreLeg, discounts: DiscountProfile): PricedLeg {
  if (leg.mode === LegMode.WALK) return corePriceLeg(leg, discounts);
  let pl: PricedLeg;
  try {
    pl = corePriceLeg(leg, discounts);
  } catch {
    return unconfirmed(leg, "calcError");
  }
  const bd = pl.breakdown;
  if (!priceKnown(pl) || bd["price_verified"] === false || truthy(bd["wartosc_zastepcza"])) {
    return unconfirmed(leg, "coreFallback", str(bd["powod_szacunku"]) ?? (bd["kategoria_pociagu"] ? str(pl.notes) : undefined));
  }
  const url = str(bd["zrodlo_url"]) ?? str(bd["zrodlo_url_cennik"]) ?? (pl.carrier === "db" ? DB_SOURCE_URL : undefined);
  const verified = str(bd["data_weryfikacji"]);
  const official = pl.price_type === "oficjalna_taryfa" && !!url && /^https:\/\//.test(url) && !!verified;
  const ui: PriceMeta = {
    status: official ? "official" : "estimate",
    source: url ? new URL(url).hostname : (pl.carrier && SOURCE_LABELS[pl.carrier]) || pl.carrier || undefined,
    sourceUrl: url,
    verified,
    reason: official ? undefined : pl.carrier === "db" ? "dbModel" : !verified ? "noVerifiedDate" : undefined,
    note: pl.notes || undefined,
  };
  return { ...pl, breakdown: { ...bd, ui } };
}

const metaOf = (pl: PricedLeg): PriceMeta => (pl.breakdown["ui"] as PriceMeta | undefined) ?? { status: "official" };

function clock(iso: string, tz?: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
  try {
    return new Intl.DateTimeFormat("pl-PL", { ...opts, timeZone: tz }).format(d);
  } catch {
    return new Intl.DateTimeFormat("pl-PL", opts).format(d);
  }
}

function uiMode(raw: TLeg, core: CoreLeg): Mode {
  if (core.mode === LegMode.RAIL) return "rail";
  return raw.mode === "BUS" || raw.mode === "COACH" ? "bus" : "local";
}

const RANK: Record<PriceStatus, number> = { official: 0, estimate: 1, unconfirmed: 2 };

function toUiLeg(raw: TLeg, pl: PricedLeg): Leg {
  const meta = metaOf(pl);
  const known = priceKnown(pl) && meta.status !== "unconfirmed";
  const name = [raw.agencyName, raw.routeShortName].filter(Boolean).join(" ") || String(raw.mode);
  return {
    mode: uiMode(raw, pl.leg),
    carrier: name,
    from: raw.from.name,
    to: raw.to.name,
    depart: clock(raw.startTime, raw.from.tz),
    arrive: clock(raw.endTime, raw.to.tz),
    price: known ? pl.amount : undefined,
    currency: known ? (pl.currency === "EUR" ? "EUR" : "PLN") : undefined,
    status: meta.status,
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    verified: meta.verified,
    note: meta.note,
    reason: meta.reason,
  };
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Drops anything from the network that does not have the shape the adapter relies on. */
export function isValidItinerary(it: unknown): it is TItinerary {
  const x = it as TItinerary | null;
  if (!x || !Array.isArray(x.legs) || x.legs.length === 0 || typeof x.startTime !== "string") return false;
  return x.legs.every(
    (l) =>
      !!l &&
      typeof l.mode === "string" &&
      typeof l.startTime === "string" &&
      typeof l.endTime === "string" &&
      !Number.isNaN(Date.parse(l.startTime)) &&
      !Number.isNaN(Date.parse(l.endTime)) &&
      !!l.from &&
      !!l.to &&
      typeof l.from.name === "string" &&
      typeof l.to.name === "string" &&
      finite(l.from.lat) &&
      finite(l.from.lon) &&
      finite(l.to.lat) &&
      finite(l.to.lon),
  );
}

/** Connection without any price (used when pricing fails): legs and times only, everything unconfirmed. */
function plainItinerary(it: TItinerary, index: number): Itinerary | null {
  const transit = it.legs.filter((l) => l.mode !== "WALK");
  if (transit.length === 0) return null;
  const legs: Leg[] = transit.map((raw) => ({
    mode: RAIL_MODES.has(raw.mode) ? "rail" : raw.mode === "BUS" || raw.mode === "COACH" ? "bus" : "local",
    carrier: [raw.agencyName, raw.routeShortName].filter(Boolean).join(" ") || String(raw.mode),
    from: raw.from.name,
    to: raw.to.name,
    depart: clock(raw.startTime, raw.from.tz),
    arrive: clock(raw.endTime, raw.to.tz),
    status: "unconfirmed",
    reason: "calcError",
  }));
  const transfers: Transfer[] = [];
  for (let k = 0; k + 1 < transit.length; k++) {
    const gap = Math.round((Date.parse(transit[k + 1].startTime) - Date.parse(transit[k].endTime)) / 60000);
    transfers.push({ place: transit[k].to.name, minutes: gap, risk: "ok" });
  }
  const dur = Math.round((Date.parse(transit[transit.length - 1].endTime) - Date.parse(transit[0].startTime)) / 60000);
  return { id: `p${index}-${it.startTime}`, legs, transfers, totalPln: 0, durationMin: dur, status: "unconfirmed", partial: true, noPrice: true, pricedLegs: 0, totalLegs: legs.length };
}

/** Prices every itinerary for the given profile and ranks it with core/. Pure: same input, same output. */
export function buildResults(input: unknown[], profile: Profile): Itinerary[] {
  const raw = input.filter(isValidItinerary);
  const discounts = toDiscountProfile(profile);
  const fallbacks: Itinerary[] = [];
  const built = raw.flatMap((it, index) => {
    try {
      const coreLegs = itineraryToLegs(it as unknown as Raw);
      const priced = coreLegs.map((leg) => priceOne(leg, discounts));
      const core = buildItinerary(`v${index}`, priced);
      const transit = it.legs.filter((l) => l.mode !== "WALK");
      return [{ index, it, coreLegs, priced, core, transit }];
    } catch (e) {
      // A pricing problem must never hide the connection itself: show it without a price.
      console.error("pricing failed for itinerary", index, e);
      const p = plainItinerary(it, index);
      if (p) fallbacks.push(p);
      return [];
    }
  });

  // Connections come from the routing engine, so a transfer our own (stricter) minimum calls
  // infeasible is shown with a warning instead of hiding the connection; such ones never get a tag.
  const usable = built.filter((b) => b.transit.length > 0);
  let tags = new Map<CoreItinerary, "cheapest" | "fastest" | "safest">();
  if (usable.length > 0) {
    try {
      const feasible = usable.filter((b) => !isInfeasible(b.core)).map((b) => b.core);
      if (feasible.length === 0) throw new Error("no feasible itinerary");
      const rec = pickRecommendations(feasible);
      const set = (k: string, tag: "cheapest" | "fastest" | "safest") => {
        const c = rec[k];
        if (c && !tags.has(c)) tags.set(c, tag);
      };
      // A "cheapest" tag on a variant without a complete price would mislead: only complete ones get it.
      if (rec["najtansza"] && priceStatus(rec["najtansza"]) === "pelna") set("najtansza", "cheapest");
      set("najszybsza", "fastest");
      if (!rec["najszybsza_bezpieczna"]?.is_safe_fallback) set("najszybsza_bezpieczna", "safest");
    } catch {
      tags = new Map();
    }
  }

  const priced = usable.flatMap((b) => {
    try {
      return [toUi(b)];
    } catch (e) {
      console.error("mapping failed for itinerary", b.index, e);
      const p = plainItinerary(b.it, b.index);
      return p ? [p] : [];
    }
  });
  return [...priced, ...fallbacks];

  function toUi(b: (typeof usable)[number]): Itinerary {
    const nonWalk = b.priced.filter((pl) => pl.leg.mode !== LegMode.WALK);
    const uiLegs = nonWalk.map((pl, k) => toUiLeg(b.transit[k], pl));
    const transfers: Transfer[] = [];
    for (let k = 0; k + 1 < nonWalk.length; k++) {
      const a = nonWalk[k].leg;
      const n = nonWalk[k + 1].leg;
      const coreIdx = b.coreLegs.indexOf(a);
      const flagged = b.core.transfer_warnings.some((w) => w.after_leg_index === coreIdx);
      // Gaps are differences of absolute instants, so time zones cannot skew them. core/ flags
      // anything under its conservative 20/30 min estimates (used for the "safest" tag), but
      // nearly every real itinerary has such a transfer, so the UI only warns below
      // SHORT_TRANSFER_UI_MIN and otherwise just shows the minutes.
      const minutes = Math.round((n.depart.getTime() - a.arrive.getTime()) / 60000);
      transfers.push({
        place: a.destination_name,
        minutes,
        risk: flagged && minutes < SHORT_TRANSFER_UI_MIN ? "tight" : "ok",
      });
    }
    const first = nonWalk[0].leg;
    const last = nonWalk[nonWalk.length - 1].leg;
    const known = nonWalk.some((pl) => priceKnown(pl) && metaOf(pl).status !== "unconfirmed");
    const status = uiLegs.reduce<PriceStatus>((w, l) => (RANK[l.status] > RANK[w] ? l.status : w), "official");
    return {
      id: `${b.index}-${b.it.startTime}`,
      tag: tags.get(b.core),
      legs: uiLegs,
      transfers,
      totalPln: b.core.total_price_pln,
      totalPlnHigh: b.core.total_price_pln_high ?? undefined,
      durationMin: Math.round((last.arrive.getTime() - first.depart.getTime()) / 60000),
      status,
      partial: priceStatus(b.core) !== "pelna" || uiLegs.some((l) => l.status === "unconfirmed"),
      noPrice: !known,
      pricedLegs: uiLegs.filter((l) => l.price !== undefined).length,
      totalLegs: uiLegs.length,
    };
  }
}
