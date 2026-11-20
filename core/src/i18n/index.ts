// Port of i18n/__init__.py: the six UI languages (Polish is the source and fallback language),
// `t`, Msg rendering and transport-mode names. The dictionaries are generated from the Python files
// (tools/golden/generate_i18n.py -> ./locales/*.json) and checked in CI, so the oracle stays the source.
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import nl from "./locales/nl.json";
import pl from "./locales/pl.json";
import { isJoined, isMsg, isPyFloat, msg, type Msg, type Text } from "./msg";
import { pyFloatStr } from "../pyCompat";

export const DEFAULT_LANG = "pl";
export const LANGUAGES = { pl: "Polski", en: "English", de: "Deutsch", es: "Español", fr: "Français", nl: "Nederlands" } as const;
export type Lang = keyof typeof LANGUAGES;

const TRANSLATIONS: Record<string, Record<string, string>> = { pl, en, de, es, fr, nl };

export const isLang = (value: unknown): value is Lang => typeof value === "string" && Object.hasOwn(LANGUAGES, value);

const has = (dict: Record<string, string>, key: string): boolean => Object.hasOwn(dict, key);

/** Python `str(value)` for the values that can be message parameters. */
function pyStr(value: unknown, lang: string): string {
  if (isMsg(value)) return renderMsg(value, lang);
  if (isJoined(value)) return value.joined.map((v) => pyStr(v, lang)).join(value.sep);
  if (isPyFloat(value)) return pyFloatStr(value.pyfloat);
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  return String(value);
}

/**
 * Text for a key in a language: a missing key falls back to Polish, a missing Polish key returns the key.
 * With `fields`, every `{name}` is replaced (a missing field is an error, like KeyError in Python).
 */
export function t(key: string, lang: string | null = null, fields: Record<string, unknown> | null = null): string {
  const code = lang && Object.hasOwn(TRANSLATIONS, lang) ? lang : lang ? "" : DEFAULT_LANG;
  let text: string | undefined = code && has(TRANSLATIONS[code], key) ? TRANSLATIONS[code][key] : undefined;
  if (text === undefined) text = has(TRANSLATIONS[DEFAULT_LANG], key) ? TRANSLATIONS[DEFAULT_LANG][key] : key;
  if (!fields || Object.keys(fields).length === 0) return text;
  return text.replace(/\{([^{}]*)\}/g, (_m, name: string) => {
    if (!Object.hasOwn(fields, name)) throw new Error(`KeyError: '${name}'`);
    return pyStr(fields[name], code || DEFAULT_LANG);
  });
}

/** Renders a message in a language (default Polish). */
export function renderMsg(m: Msg, lang: string | null = null): string {
  const code = lang ?? DEFAULT_LANG;
  const params: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(m.params)) params[name] = pyStr(value, code);
  return t(m.key, code, params);
}

/** `tm`: a Msg is rendered from its key, a plain string is left alone. */
export const tm = (value: Text | null | undefined, lang: string | null = null): string => (isMsg(value) ? renderMsg(value, lang) : String(value));

/** Label with a translation under `prefix.key`, otherwise `fallback` (a raw label that stays in Polish). */
export function labelOr(prefix: string, key: string, fallback: string, lang: string | null = null): string {
  const full = `${prefix}.${key}`;
  return has(TRANSLATIONS[DEFAULT_LANG], full) ? t(full, lang) : fallback;
}

/** Name of a transport kind from a raw MOTIS mode ("REGIONAL_RAIL" -> "kolej regionalna"); an unknown mode becomes readable text. */
export function transportModeName(motisMode: string): Text {
  const key = `tmode.${motisMode.toLowerCase()}`;
  if (has(TRANSLATIONS[DEFAULT_LANG], key)) return msg(key);
  return motisMode.replaceAll("_", " ").toLowerCase();
}

/** The Polish text of a Msg, which is what `str(Msg)` gives in the oracle. */
export const msgText = (m: Msg): string => renderMsg(m, DEFAULT_LANG);
