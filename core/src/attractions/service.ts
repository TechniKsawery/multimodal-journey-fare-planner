// Port of attractions/service.py: attraction catalogue, filtering and the city-card calculator.
import attractionsData from "../../../data/attractions/attractions.json";
import cityCardsData from "../../../data/attractions/city_cards.json";
import de from "../../../data/attractions/translations/de.json";
import en from "../../../data/attractions/translations/en.json";
import es from "../../../data/attractions/translations/es.json";
import fr from "../../../data/attractions/translations/fr.json";
import nl from "../../../data/attractions/translations/nl.json";
import { convert } from "../common/currency";
import { compareIsoDates, formatFixed, round2, truthy } from "../pyCompat";
import {
  AttractionCategory,
  isCompleteSource,
  type Attraction,
  type CityCard,
  type CityCardEvaluation,
  type CityCardVariant,
  type DiscountSource,
  type GroupPrice,
  type HeldDocument,
} from "./model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

// Document types treated as "student/pupil status" / "senior status" when matching HeldDocument.
const STUDENT_DOC_TYPES = new Set(["legitymacja_szkolna", "legitymacja_studencka", "ISIC"]);
const SENIOR_DOC_TYPES = new Set(["karta_seniora"]);

/** Discount titles a person holds, independent of any city card. */
export interface DiscountProfile {
  age: number | null;
  is_student: boolean;
  is_senior: boolean;
  documents: HeldDocument[];
}

export function makeProfile(init: Partial<DiscountProfile> = {}): DiscountProfile {
  return { age: null, is_student: false, is_senior: false, documents: [], ...init };
}

/** A matching document type whose issuing country the discount recognises (null = no restriction). */
export function hasRecognizedDocument(
  profile: DiscountProfile,
  docTypes: ReadonlySet<string>,
  recognizedCountries: string[] | null,
): boolean {
  return profile.documents.some(
    (doc) => docTypes.has(doc.doc_type) && (recognizedCountries === null || recognizedCountries.includes(doc.issuing_country)),
  );
}

// Order matters: the first matching alias wins (same as the dict order in Python).
const CITY_ALIASES: readonly (readonly [string, string])[] = [
  ["gelsenkirchen", "gelsenkirchen"],
  ["buer", "gelsenkirchen"],
  ["essen", "gelsenkirchen"],
  ["dortmund", "gelsenkirchen"],
  ["bochum", "gelsenkirchen"],
  ["duisburg", "gelsenkirchen"],
  ["oberhausen", "gelsenkirchen"],
  ["ruhr", "gelsenkirchen"],
  ["vrr", "gelsenkirchen"],
  ["berlin", "berlin"],
  ["krakow", "krakow"],
  ["kraków", "krakow"],
  ["lublin", "lublin"],
  ["warszawa", "warszawa"],
  ["warsaw", "warszawa"],
  ["poznan", "poznan"],
  ["poznań", "poznan"],
  ["hamburg", "hamburg"],
  ["munchen", "munchen"],
  ["münchen", "munchen"],
  ["munich", "munchen"],
  ["monachium", "munchen"],
  ["koln", "koln"],
  ["köln", "koln"],
  ["cologne", "koln"],
  ["kolonia", "koln"],
  ["wroclaw", "wroclaw"],
  ["wrocław", "wroclaw"],
];

// JS `\b` is ASCII-only even with the u flag; Python's is Unicode-aware. These lookarounds are the
// Unicode word boundaries (start / end of a run of letters, digits and underscore).
const WB_START = "(?<![\\p{L}\\p{N}_])";
const WB_END = "(?![\\p{L}\\p{N}_])";

const stripAccents = (text: string): string => text.normalize("NFKD").replace(/\p{Mn}/gu, "");
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ALIAS_PATTERNS: readonly (readonly [RegExp, string])[] = CITY_ALIASES.map(([token, canonical]) => [
  new RegExp(`${WB_START}${escapeRegExp(stripAccents(token))}${WB_END}`, "u"),
  canonical,
]);

/** Recognises a city id from an address or place name. */
export function normalizeCity(query: string | null | undefined): string | null {
  if (!query) return null;
  // Comma-separated segments first, from the end (that is where the city usually is: "Ulica 1, Lublin").
  let segments = query.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (segments.length === 0) segments = [query.trim()];
  for (const seg of [...segments].reverse()) {
    const cleaned = stripAccents(seg.toLowerCase());
    for (const [re, canonical] of ALIAS_PATTERNS) if (re.test(cleaned)) return canonical;
  }
  const whole = stripAccents(query.toLowerCase());
  for (const [re, canonical] of ALIAS_PATTERNS) if (re.test(whole)) return canonical;
  return null;
}

const loadSource = (item: Raw | null | undefined): DiscountSource | null =>
  truthy(item) ? { source_url: String(item!["source_url"] ?? ""), verified_date: String(item!["verified_date"] ?? "") } : null;

function loadGroupPrice(item: Raw | null | undefined): GroupPrice | null {
  if (!truthy(item)) return null;
  const i = item as Raw;
  return {
    price: Number(i["price"]),
    label: i["label"],
    min_age: i["min_age"] ?? null,
    max_age: i["max_age"] ?? null,
    requires_status: i["requires_status"] ?? "",
    source_url: i["source_url"] ?? "",
    verified_date: i["verified_date"] ?? "",
    price_verified: truthy(i["price_verified"] ?? false),
    recognized_countries: i["recognized_countries"] ?? null,
  };
}

// ---- working-note filter (never shown to users) --------------------------------------------------
// Verification notes that leaked into descriptions ("POPRAWKA 2026-10-10", "wg Gemini", quotes,
// source URLs) are not user content in any language. public_text() is the safety net on load/display.
const NOTE_SOURCE = [
  `${WB_START}Gemini${WB_END}`,
  `${WB_START}(?:POPRAWKA|KORREKTUR|CORRECTION|CORRECCIÓN|CORRECTIE)${WB_END}`,
  `${WB_START}(?:NIE)?POTWIERDZONE${WB_END}`,
  `${WB_START}UNCONFIRMED${WB_END}`,
  `${WB_START}CONFIRMED LIVE${WB_END}`,
  `${WB_START}UNBESTÄTIGT${WB_END}`,
  `${WB_START}LIVE BESTÄTIGT${WB_END}`,
  `${WB_START}SIN CONFIRMAR${WB_END}`,
  `${WB_START}CONFIRMADO EN VIVO${WB_END}`,
  `${WB_START}NON CONFIRMÉ${WB_END}`,
  `${WB_START}CONFIRMÉ EN DIRECT${WB_END}`,
  `${WB_START}ONBEVESTIGD${WB_END}`,
  `${WB_START}LIVE BEVESTIGD${WB_END}`,
  "DODATKOWY DOWÓD",
  "ADDITIONAL EVIDENCE",
  "ZUSÄTZLICHER BEWEIS",
  "PRUEBA ADICIONAL",
  "PREUVE SUPPLÉMENTAIRE",
  "EXTRA BEWIJS",
  "niepotwierdzon[\\p{L}\\p{N}_]* u (?:źródła|operatora)",
  "not confirmed (?:at the source|with the operator)",
  "(?:an der Quelle|beim Betreiber) nicht bestätigt",
  "no confirmado (?:en la fuente|con el operador)",
  "non confirmé (?:à la source|auprès de l'exploitant)",
  "niet bevestigd bij (?:de bron|de exploitant)",
  `${WB_START}20\\d\\d-\\d\\d-\\d\\d${WB_END}`,
  "[a-z0-9-]+\\.(?:de|pl|com|eu|org)/\\S",
  "certificate has expired",
].join("|");
const WORKING_NOTE_MARKERS = new RegExp(NOTE_SOURCE, "u");
const PARENTHETICAL = /\s*\([^()]*\)/gu;
const SENTENCE_END = /(?<=[.!?])\s+/u;

export const hasWorkingNote = (text: string): boolean => WORKING_NOTE_MARKERS.test(text);

/** Text without working notes: parentheticals with a note go first, then whole sentences with one. */
export function publicText(text: string): string {
  if (!hasWorkingNote(text)) return text;
  const stripped = text.replace(PARENTHETICAL, (m) => (hasWorkingNote(m) ? "" : m));
  return stripped
    .split(SENTENCE_END)
    .filter((x) => !hasWorkingNote(x))
    .join(" ")
    .trim();
}

// ---- catalogue -----------------------------------------------------------------------------------
export function getAllAttractions(): Attraction[] {
  return (attractionsData as Raw)["atrakcje"].map((item: Raw): Attraction => ({
    id: item["id"],
    name: item["name"],
    city: item["city"],
    category: item["category"] as AttractionCategory,
    description: publicText(item["description"]),
    normal_price: Number(item["normal_price"]),
    currency: item["currency"],
    default_card_discount_percent: Number(item["default_card_discount_percent"] ?? 0.0),
    card_discount_source: loadSource(item["card_discount_source"]),
    address: item["address"] ?? "",
    official_url: item["official_url"] ?? "",
    highlight: truthy(item["highlight"] ?? false),
    tags: [...(item["tags"] ?? [])],
    price_verified: truthy(item["price_verified"] ?? false),
    child_price: loadGroupPrice(item["child_price"]),
    student_price: loadGroupPrice(item["student_price"]),
    senior_price: loadGroupPrice(item["senior_price"]),
    family_price: loadGroupPrice(item["family_price"]),
    dynamic_pricing: truthy(item["dynamic_pricing"] ?? false),
    price_is_from: truthy(item["price_is_from"] ?? false) || truthy(item["dynamic_pricing"] ?? false),
    variable_pricing_note: publicText(item["variable_pricing_note"] ?? ""),
    closed_until: item["closed_until"] ?? "",
    closed_source_url: item["closed_source_url"] ?? "",
  }));
}

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True when the attraction has a closure flag and its end date has not passed yet. `today` is YYYY-MM-DD. */
export function isClosed(attraction: Attraction, today: string | null = null): boolean {
  if (!attraction.closed_until) return false;
  return compareIsoDates(today ?? localToday(), attraction.closed_until) <= 0;
}

export function getAttractions(
  city: string | null = null,
  category: AttractionCategory | null = null,
  includeClosed = false,
  today: string | null = null,
): Attraction[] {
  const cityKey = city ? normalizeCity(city) : null;
  return getAllAttractions().filter((a) => {
    if (cityKey && a.city !== cityKey) return false;
    if (category && a.category !== category) return false;
    if (!includeClosed && isClosed(a, today)) return false;
    return true;
  });
}

export function getAllCityCards(): CityCard[] {
  return (cityCardsData as Raw)["karty"].map((item: Raw): CityCard => {
    const sources: Record<string, DiscountSource> = {};
    for (const [aid, rawSrc] of Object.entries((item["custom_discount_sources"] ?? {}) as Raw)) {
      const src = loadSource(rawSrc);
      if (src !== null) sources[aid] = src;
    }
    return {
      id: item["id"],
      city: item["city"],
      name: item["name"],
      description: item["description"],
      official_url: item["official_url"],
      variants: (item["variants"] as Raw[]).map(
        (v): CityCardVariant => ({
          id: v["id"],
          name: v["name"],
          duration_hours: Math.trunc(Number(v["duration_hours"])),
          price: Number(v["price"]),
          currency: v["currency"],
          includes_public_transit: truthy(v["includes_public_transit"]),
          transit_zones: v["transit_zones"],
          description: v["description"],
          price_verified: truthy(v["price_verified"] ?? false),
        }),
      ),
      custom_discounts: { ...(item["custom_discounts"] ?? {}) },
      custom_discount_sources: sources,
      existence_verified: truthy(item["existence_verified"] ?? false),
      existence_source_url: item["existence_source_url"] ?? "",
      existence_verified_date: item["existence_verified_date"] ?? "",
    };
  });
}

/** Cards for a city, ONLY those whose existence is confirmed (an unconfirmed price may remain, existence may not). */
export function getCityCards(city: string | null = null): CityCard[] {
  const cards = getAllCityCards().filter((c) => c.existence_verified);
  const cityKey = city ? normalizeCity(city) : null;
  return cityKey ? cards.filter((c) => c.city === cityKey) : cards;
}

// ---- prices --------------------------------------------------------------------------------------
/** With an age limit and an unknown age no discount is given (never guessed). */
function ageInRange(gp: GroupPrice, age: number | null): boolean {
  if (gp.min_age === null && gp.max_age === null) return true;
  if (age === null) return false;
  return (gp.min_age === null || age >= gp.min_age) && (gp.max_age === null || age <= gp.max_age);
}

function statusTitleApplies(gp: GroupPrice, profile: DiscountProfile, flag: boolean, docTypes: ReadonlySet<string>): boolean {
  if (!ageInRange(gp, profile.age)) return false;
  if (gp.recognized_countries !== null) return hasRecognizedDocument(profile, docTypes, gp.recognized_countries);
  return flag || hasRecognizedDocument(profile, docTypes, null);
}

// ---- translations --------------------------------------------------------------------------------
const TRANSLATIONS: Record<string, Raw> = { de, en, es, fr, nl };
const translations = (lang: string): Raw => (Object.hasOwn(TRANSLATIONS, lang) ? TRANSLATIONS[lang] : {});

export function localizedDescription(attraction: Attraction, lang: string | null = null): string {
  const translated = (translations(lang || "pl")["descriptions"] ?? {})[attraction.id];
  return publicText(translated || attraction.description);
}

export function priceFromNote(attraction: Attraction, lang: string | null = null): string {
  if (!attraction.price_is_from) return "";
  const translated = (translations(lang || "pl")["notes"] ?? {})[attraction.id];
  const note = translated || attraction.variable_pricing_note || "ceny zależą od terminu/wariantu, ulgi możliwe";
  return publicText(note);
}

/**
 * Cheapest entry price the person is entitled to from ANY title (age, pupil/student, senior),
 * independent of a city card. Returns [price, label, GroupPrice | null for the standard price].
 * Never guesses: a title counts only if the attraction has a GroupPrice for it in the data.
 */
export function bestPriceForAttraction(
  attraction: Attraction,
  profile: DiscountProfile | null = null,
): [number, string, GroupPrice | null] {
  const candidates: [number, string, GroupPrice | null][] = [[attraction.normal_price, "Cena standardowa (dorosły)", null]];
  // Dynamic prices: no fixed discount amount, so the "from" price stays.
  if (profile !== null && !attraction.dynamic_pricing) {
    let gp = attraction.child_price;
    // A child price with NO age limit cannot apply to an adult: an upper bound is required.
    if (gp !== null && profile.age !== null && gp.max_age !== null && ageInRange(gp, profile.age)) {
      candidates.push([gp.price, gp.label, gp]);
    }
    gp = attraction.student_price;
    if (gp !== null && statusTitleApplies(gp, profile, profile.is_student, STUDENT_DOC_TYPES)) {
      candidates.push([gp.price, gp.label, gp]);
    }
    gp = attraction.senior_price;
    if (
      gp !== null &&
      (statusTitleApplies(gp, profile, profile.is_senior, SENIOR_DOC_TYPES) ||
        (profile.age !== null &&
          gp.min_age !== null &&
          profile.age >= gp.min_age &&
          (gp.max_age === null || profile.age <= gp.max_age)))
    ) {
      candidates.push([gp.price, gp.label, gp]);
    }
  }
  let best = candidates[0];
  for (const c of candidates) if (c[0] < best[0]) best = c; // first minimum wins, like Python min()
  return best;
}

/** Card discount on an attraction: [percent, unverified]. A discount > 0% counts only with a complete source. */
function resolveCardDiscount(card: CityCard, variant: CityCardVariant, attraction: Attraction): [number, boolean] {
  // Special entitlement of a specific variant (Berlin WelcomeCard Museumsinsel: 100% on the museums).
  if (variant.id === "bwc_72h_museumsinsel" && attraction.id === "berlin_museumsinsel") return [100.0, false];

  let percent: number;
  let source: DiscountSource | null;
  if (Object.hasOwn(card.custom_discounts, attraction.id)) {
    percent = card.custom_discounts[attraction.id];
    source = Object.hasOwn(card.custom_discount_sources, attraction.id) ? card.custom_discount_sources[attraction.id] : null;
  } else {
    percent = attraction.default_card_discount_percent;
    source = attraction.card_discount_source;
  }
  if (percent === 0.0 && Object.hasOwn(card.custom_discounts, attraction.id)) return [0.0, false];
  if (percent > 0.0 && source !== null && isCompleteSource(source)) return [percent, false];
  // No entry or no source: the card's discount is not guessed (0%, flagged unverified).
  return [0.0, true];
}

export function evaluateCityCardVariant(
  card: CityCard,
  variant: CityCardVariant,
  attractions: Attraction[],
  estimatedTransitCost = 0.0,
  profile: DiscountProfile | null = null,
): CityCardEvaluation {
  let priceWithout = 0.0;
  let priceWith = 0.0;

  // Settlement currency = the attractions' currency when uniform, otherwise the card variant's.
  const currencies = new Set(attractions.map((a) => a.currency));
  const currency = currencies.size === 1 ? [...currencies][0] : variant.currency;
  const cardPrice = convert(variant.price, variant.currency, currency);

  const unverified: string[] = [];
  for (const a of attractions) {
    const [bestPrice] = bestPriceForAttraction(a, profile);
    const basePrice = convert(bestPrice, a.currency, currency);
    priceWithout += basePrice;
    const [discPct, isUnverified] = resolveCardDiscount(card, variant, a);
    if (isUnverified) unverified.push(a.id);
    priceWith += Math.max(0.0, basePrice * (1.0 - discPct / 100.0));
  }

  const transitSavings = variant.includes_public_transit ? estimatedTransitCost : 0.0;
  const totalWithout = priceWithout + estimatedTransitCost;
  // A variant WITHOUT transit does not remove the transit cost: it is paid either way.
  const totalWith = cardPrice + priceWith + (variant.includes_public_transit ? 0.0 : estimatedTransitCost);

  const netSavings = round2(totalWithout - totalWith);
  const isRecommended = netSavings > 0.0;
  const f = (x: number) => formatFixed(x, 2);

  let summary: string;
  if (isRecommended) {
    summary =
      `Kupno ${variant.name} opłaca się! Zaoszczędzisz łącznie ${f(netSavings)} ${currency} ` +
      `(wstępy: ${f(priceWithout - priceWith)} ${currency} zniżki` +
      (variant.includes_public_transit && transitSavings > 0 ? ", transport: darmowy w cenie karty" : "") +
      ").";
  } else {
    const diff = Math.abs(netSavings);
    summary =
      `${variant.name} kosztuje ${f(cardPrice)} ${currency}. ` +
      `Przy obecnym zestawie atrakcji zabraknie około ${f(diff)} ${currency} ` +
      "do zwrotu kosztu karty.";
  }
  if (unverified.length > 0) {
    summary +=
      ` Brak zapisanej zniżki karty dla: ${unverified.join(", ")} — liczone jako 0% ` +
      "(niezweryfikowane, karta może dawać zniżkę, której nie mamy w danych).";
  }

  return {
    card_name: card.name,
    variant,
    attractions_count: attractions.length,
    attractions_price_without_card: round2(priceWithout),
    attractions_price_with_card: round2(priceWith),
    card_price: round2(cardPrice),
    estimated_transit_savings: round2(transitSavings),
    total_cost_without_card: round2(totalWithout),
    total_cost_with_card: round2(totalWith),
    net_savings: netSavings,
    currency,
    is_recommended: isRecommended,
    summary,
    unverified_discount_attraction_ids: unverified,
  };
}

export function evaluateCityCards(
  city: string,
  attractions: Attraction[],
  estimatedTransitCost = 0.0,
  profile: DiscountProfile | null = null,
): CityCardEvaluation[] {
  return getCityCards(city).flatMap((card) =>
    card.variants.map((variant) => evaluateCityCardVariant(card, variant, attractions, estimatedTransitCost, profile)),
  );
}

/** The most profitable card variant for the given attractions (or null). */
export function suggestBestCityCard(
  city: string,
  attractions: Attraction[],
  estimatedTransitCost = 0.0,
  profile: DiscountProfile | null = null,
): CityCardEvaluation | null {
  const profitable = evaluateCityCards(city, attractions, estimatedTransitCost, profile).filter((e) => e.is_recommended);
  if (profitable.length === 0) return null;
  profitable.sort((a, b) => b.net_savings - a.net_savings); // stable: ties keep their order, like Python
  return profitable[0];
}
