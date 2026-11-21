// Port of places/aliases.py: city names in the interface languages (PL, EN, DE, ES, FR, NL) from data/places/aliases.json.
//
//  - search: any spelling ("Krakau", "Cologne", "Monachium", "Koeln") gives the same place; the geocoder gets the
//    LOCAL name (`localQuery`), because it returns only one name per place;
//  - display: a city (or a station starting with its name, "Köln Hbf") is shown in the interface language and the
//    local name goes next to it (`localizeName`).
//
// Nothing is guessed here: an empty name in a language = no separate name (the local one is used).
import data from "../../../data/places/aliases.json";
import { ValueError } from "../pyCompat";

export const LANGUAGES = ["pl", "en", "de", "es", "fr", "nl"] as const;

/** Radius around the city coordinates beyond which a geocoder hit is another place with the same name. */
export const CITY_RADIUS_KM = 25.0;

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue" };
// Words after which a city name is only the beginning of a longer place name ("Frankfurt Oder").
const CONTINUATION = new Set(["oder", "an", "am", "im", "bei", "ob", "in", "nad"]);
// The longest alias has 5 words ("Landsberg an der Warthe").
const MAX_ALIAS_WORDS = 5;

const translateUmlauts = (s: string): string => s.replace(/[äöüÄÖÜ]/g, (c) => UMLAUTS[c]);

/** Text for comparisons: lower case, no Polish/German diacritics and no punctuation (Python casefold + NFKD). */
export function fold(text: string): string {
  let t = text.toLowerCase().replace(/ß|ẞ/g, "ss").replace(/ł/g, "l");
  t = t.normalize("NFKD").replace(/\p{M}/gu, "");
  return t
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .join(" ");
}

export interface City {
  key: string;
  local: string; // name in the city's country, as the geocoder returns it ("Köln", "Kraków", "Praha")
  country: string;
  display: Record<string, string>; // language -> display name ("" = no separate name)
  aliases: string[]; // extra spellings for search only, never shown
  verified: boolean;
  lat: number | null;
  lon: number | null;
}

/** The city's name in a language; no separate name (or an unknown language) = the local name. */
export function cityName(city: City, lang: string | null): string {
  return city.display[lang ?? ""] || city.local;
}

export function searchNames(city: City): string[] {
  const out = [city.local, ...Object.values(city.display), ...city.aliases];
  return [...new Set(out.filter((n) => n))];
}

function str(v: unknown, what: string): string {
  if (typeof v !== "string") throw new ValueError(`aliases.json: ${what} musi być tekstem`);
  return v;
}

function parseCities(raw: unknown): City[] {
  const miasta = (raw as { miasta?: unknown } | null)?.miasta;
  if (!miasta || typeof miasta !== "object" || Array.isArray(miasta)) throw new ValueError("aliases.json: brak sekcji miasta");
  return Object.entries(miasta as Record<string, unknown>).map(([key, e]) => {
    const entry = e as Record<string, unknown>;
    const display = entry["wyswietlana"] as Record<string, unknown>;
    const aliases = entry["aliasy_wyszukiwania"];
    if (!display || typeof display !== "object" || !Array.isArray(aliases)) throw new ValueError(`aliases.json: zły wpis ${key}`);
    const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
    return {
      key,
      local: str(entry["local"], `${key}.local`),
      country: str(entry["kraj"], `${key}.kraj`),
      display: Object.fromEntries(Object.entries(display).map(([k, v]) => [k, str(v, `${key}.wyswietlana.${k}`)])),
      aliases: aliases.map((a) => str(a, `${key}.aliasy_wyszukiwania`)),
      verified: Boolean(entry["zweryfikowano"]),
      lat: num(entry["lat"]),
      lon: num(entry["lon"]),
    };
  });
}

let CITIES: City[] | null = null;
let INDEX: Map<string, City> | null = null;
let LOCAL_INDEX: Map<string, City> | null = null;

export function loadCities(): City[] {
  return (CITIES ??= parseCities(data));
}

/** Folded spelling -> city. "Köln" also has the variant "koeln" (umlaut as ae/oe/ue). */
function index(): Map<string, City> {
  if (!INDEX) {
    INDEX = new Map();
    for (const city of loadCities()) {
      for (const name of searchNames(city)) {
        for (const variant of new Set([fold(name), fold(translateUmlauts(name))])) {
          if (!INDEX.has(variant)) INDEX.set(variant, city);
        }
      }
    }
  }
  return INDEX;
}

/** Local names only: that is how the geocoder names places (Polish "Praga" is also a Warsaw district). */
function localIndex(): Map<string, City> {
  if (!LOCAL_INDEX) {
    LOCAL_INDEX = new Map();
    for (const city of loadCities()) {
      for (const variant of new Set([fold(city.local), fold(translateUmlauts(city.local))])) {
        if (!LOCAL_INDEX.has(variant)) LOCAL_INDEX.set(variant, city);
      }
    }
  }
  return LOCAL_INDEX;
}

/** The city with this name in any language (case and diacritics ignored), else null. */
export function findCity(text: string): City | null {
  return index().get(fold(text)) ?? null;
}

/** Folded name (any language) -> local city name; for typo correction. */
export function aliasNames(): Record<string, string> {
  return Object.fromEntries([...index()].map(([name, city]) => [name, city.local]));
}

interface Token {
  text: string;
  end: number;
}

function tokens(part: string): Token[] {
  return [...part.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ text: m[0], end: (m.index as number) + m[0].length }));
}

/** The city whose name is the beginning of the text (all of it or its first words), and where the name ends. */
function matchPrefix(part: string, idx: Map<string, City>): [City, number] | null {
  const toks = tokens(part);
  const folded = toks.map((t) => fold(t.text));
  for (let k = Math.min(toks.length, MAX_ALIAS_WORDS); k > 0; k--) {
    const city = idx.get(folded.slice(0, k).filter(Boolean).join(" "));
    if (city !== undefined) {
      if (k < toks.length && CONTINUATION.has(folded[k])) continue;
      return [city, toks[k - 1].end];
    }
  }
  return null;
}

const HAS_DIGIT = /[\p{Nd}²³¹]/u;
const leading = (part: string): string => part.slice(0, part.length - part.trimStart().length);

/** Replaces the city name at the beginning of a part with its name in `lang` (null = local); the rest stays. Parts with digits are untouched. */
function replacePrefix(part: string, idx: Map<string, City>, lang: string | null): string {
  if (HAS_DIGIT.test(part)) return part;
  const found = matchPrefix(part, idx);
  if (found === null) return part;
  const [city, end] = found;
  return leading(part) + cityName(city, lang) + part.slice(end);
}

/** A part that is entirely a city name (maybe followed by punctuation), in the name from `lang`. */
function whole(part: string, idx: Map<string, City>, lang: string | null): string {
  const found = matchPrefix(part, idx);
  if (found === null || /[\p{L}\p{N}]/u.test(part.slice(found[1]))) return part;
  const [city, end] = found;
  return leading(part) + cityName(city, lang) + part.slice(end);
}

/** Typed text with city names in any language turned into local ones ("Cologne" -> "Köln", "Krakau, Hbf" -> "Kraków, Hbf"). */
export function localQuery(text: string): string {
  const idx = index();
  return text
    .split(",")
    .map((p) => replacePrefix(p, idx, null))
    .join(",");
}

/**
 * [name to show, local name or null] for a geocoder name. A city, or a station starting with the local city name
 * ("Köln Hbf"), gets the name from the interface language ("Cologne Hbf") and the original comes back second.
 * When nothing changes: [name, null].
 */
export function localizeName(name: string, lang: string | null): [string, string | null] {
  const idx = localIndex();
  const shown = name
    .split(", ")
    .map((p) => p.trim())
    .map((p, i) => (i === 0 ? replacePrefix(p, idx, lang) : whole(p, idx, lang)));
  const display = shown.join(", ");
  return display === name ? [display, null] : [display, name];
}

/** A name to put into a sentence: "Cologne (Köln)", or just "Berlin" when both names are equal. */
export function placeText(name: string, lang: string | null, template = "{shown} ({local})"): string {
  const [shown, local] = localizeName(name, lang);
  return local === null ? shown : template.replace("{shown}", () => shown).replace("{local}", () => local);
}
