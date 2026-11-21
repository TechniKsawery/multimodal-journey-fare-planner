import plJson from './locales/pl.json';
import enJson from './locales/en.json';
import deJson from './locales/de.json';
import esJson from './locales/es.json';
import frJson from './locales/fr.json';
import nlJson from './locales/nl.json';

export const LANGS = ['pl', 'en', 'de', 'es', 'fr', 'nl'] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_NAMES: Record<Lang, string> = {
  pl: 'Polski',
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  nl: 'Nederlands',
};

export const LOCALE: Record<Lang, string> = {
  pl: 'pl-PL',
  en: 'en-GB',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR',
  nl: 'nl-NL',
};

export const RAW: Record<Lang, Record<string, string>> = {
  pl: plJson,
  en: enJson,
  de: deJson,
  es: esJson,
  fr: frJson,
  nl: nlJson,
};

type Params = Record<string, string | number>;

function fill(s: string, p: Params): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''));
}

/** Plural key suffix for a language (Intl.PluralRules), e.g. one/few/many/other. */
function pluralKey(lang: Lang, n: number): string {
  return new Intl.PluralRules(LOCALE[lang]).select(n);
}

function plural(lang: Lang, base: string, n: number): string {
  const r = RAW[lang];
  return fill(r[`${base}_${pluralKey(lang, n)}`] ?? r[`${base}_other`] ?? '', { n });
}

const STRING_KEYS = [
  'title', 'demo', 'footerAttr', 'footerLive', 'footerSources', 'from', 'to', 'date', 'swap',
  'search', 'profile', 'profileSummary', 'who_none', 'who_student', 'who_pupil', 'idCountry',
  'pl', 'de', 'age', 'bahncard', 'bc_none', 'results', 'active', 'inactive', 'change',
  'chipDiscount', 'chipId', 'chipBc', 'chipNone', 'chipHint', 'tag_cheapest', 'tag_fastest',
  'tag_safest', 'tab_all', 'tab_fastest', 'tab_cheapest', 'tab_safest', 'filter_confirmed_only', 'filter_no_results',
  'sort', 'sort_price', 'sort_time', 'official', 'ceiling', 'estimate', 'unconfirmed',
  'official_hint', 'ceiling_hint', 'estimate_hint', 'unconfirmed_hint', 'partial', 'details', 'hide', 'source',
  'verified', 'buy', 'tight', 'minutes', 'instead', 'warnTitle', 'warnText', 'theme', 'themeAuto',
  'themeLight', 'themeDark', 'lang', 'skip', 'empty', 'mode_rail', 'mode_bus', 'mode_flight',
  'mode_walk', 'mode_local', 'time', 'searching', 'placePlaceholder', 'noPlaces', 'geocodeBudget',
  'geocodeDown', 'noResults', 'errBudget', 'errBusy', 'errNetwork', 'errGeneric', 'errPlace',
  'errTime', 'errPast', 'queryUsed', 'tryTomorrow', 'priceNote', 'noPrice', 'reason_crossBorder',
  'reason_premiumTrain', 'reason_unknownCategory', 'reason_flixbus', 'reason_local',
  'reason_otherCarrier', 'reason_calcError', 'reason_coreFallback', 'reason_noCoords',
  'reason_noVerifiedDate', 'reason_dbModel', 'appError', 'reload', 'pageTitle', 'pageDescription',
] as const;

type StringKey = (typeof STRING_KEYS)[number];

export type Dict = Record<StringKey, string> & {
  resultsCount: (n: number) => string;
  transfersN: (n: number) => string;
  fromApi: (n: number) => string;
  budgetLeft: (n: number) => string;
  partialCover: (n: number, m: number) => string;
};

function build(lang: Lang): Dict {
  const r = RAW[lang];
  const base = {} as Record<StringKey, string>;
  for (const k of STRING_KEYS) base[k] = r[k] ?? RAW.en[k] ?? k;
  return {
    ...base,
    resultsCount: (n) => plural(lang, 'resultsCount', n),
    transfersN: (n) => (n === 0 ? r.transfers_0 : plural(lang, 'transfers', n)),
    fromApi: (n) => fill(r.fromApi, { n }),
    budgetLeft: (n) => fill(r.budgetLeft, { n }),
    partialCover: (n, m) => fill(r.partialCover, { n, m }),
  };
}

export const dict = Object.fromEntries(LANGS.map((l) => [l, build(l)])) as Record<Lang, Dict>;

export function isLang(x: unknown): x is Lang {
  return typeof x === 'string' && (LANGS as readonly string[]).includes(x);
}

/** First supported language from the browser's preferences, else English. */
export function detectLang(prefs: readonly string[] | undefined): Lang {
  for (const p of prefs ?? []) {
    const base = p.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

export function fmtDuration(min: number, lang: Lang = 'pl'): string {
  const r = RAW[lang];
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h
    ? fill(r.duration, { h, m: String(m).padStart(2, '0') })
    : fill(r.durationMin, { m });
}

export function fmtMoney(n: number, cur: string, lang: Lang): string {
  return new Intl.NumberFormat(LOCALE[lang], {
    style: 'currency',
    currency: cur,
    maximumFractionDigits: 0,
  }).format(n);
}
