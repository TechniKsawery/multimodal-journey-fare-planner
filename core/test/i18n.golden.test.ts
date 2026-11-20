// Golden tests for the i18n port: every key in every language with rotating parameter types.
import { describe, expect, it } from "vitest";
import golden from "../golden/i18n.json";
import { DEFAULT_LANG, LANGUAGES, labelOr, msgText, renderMsg, t, tm, transportModeName } from "../src/i18n";
import de from "../src/i18n/locales/de.json";
import en from "../src/i18n/locales/en.json";
import es from "../src/i18n/locales/es.json";
import fr from "../src/i18n/locales/fr.json";
import nl from "../src/i18n/locales/nl.json";
import pl from "../src/i18n/locales/pl.json";
import { isMsg, joined, msg, pyFloat } from "../src/i18n/msg";
import { fnv1a64 } from "./golden";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const data = golden as unknown as Json;
const locale = (l: string) => ({ pl, en, de, es, fr, nl })[l as "pl"];

function build(d: Json): unknown {
  switch (d.t) {
    case "msg":
      return msg(d.key, Object.fromEntries(Object.entries(d.params ?? {}).map(([k, v]) => [k, build(v as Json)])));
    case "joined":
      return joined((d.items as Json[]).map(build), d.sep);
    case "float":
      return pyFloat(d.v);
    default:
      return d.v;
  }
}

describe("rendering", () => {
  it("every key x 3 parameter assignments x 6 languages", () => {
    const langs = data.langs as string[];
    expect(langs).toEqual(Object.keys(LANGUAGES));
    const bad: string[] = [];
    let i = 0;
    for (const c of data.cases as Json[]) {
      const m = msg(c.key, Object.fromEntries(Object.entries(c.params).map(([k, v]) => [k, build(v as Json)])));
      for (const lang of langs) {
        const got = fnv1a64(renderMsg(m, lang)).slice(0, 12);
        if (got !== data.hashes[i++]) bad.push(`${c.key} [${lang}] -> ${renderMsg(m, lang)}`);
      }
    }
    expect(i).toBe(data.hashes.length);
    expect(bad.slice(0, 3)).toEqual([]);
  });
  it("readable samples", () => {
    for (const r of data.readable as Json[]) {
      const m = msg(r.key, Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, build(v as Json)])));
      expect(renderMsg(m, r.lang), `${r.key} ${r.lang}`).toBe(r.text);
    }
  });
});

describe("fallbacks and helpers", () => {
  const x = data.extra;
  it("missing key / language", () => {
    expect(t("no.such.key", "en")).toBe(x.t_missing_key);
    expect(t("yes", "xx")).toBe(x.t_missing_lang);
    for (const [lang, text] of Object.entries(x.t_fallback_pl)) expect(t("yes", lang)).toBe(text);
    expect(t("skip.part_other_day", "pl")).toBe(x.t_no_fields_untouched);
  });
  it("tm and Msg text", () => {
    expect(tm("plain")).toBe(x.tm_str);
    for (const [lang, text] of Object.entries(x.tm_msg)) expect(tm(msg("variant.walk"), lang)).toBe(text);
    expect(msgText(msg("variant.rail_only", { modes: joined(["a", "b"], "/"), transfers: 2 }))).toBe(x.msg_polish_text);
  });
  it("transport mode names", () => {
    for (const [mode, [text, translatable]] of Object.entries(x.transport_modes as Record<string, [string, boolean]>)) {
      const got = transportModeName(mode);
      expect(isMsg(got)).toBe(translatable);
      expect(tm(got)).toBe(text);
    }
  });
  it("a missing field is an error; labelOr falls back", () => {
    expect(() => t("skip.part_other_day", "pl", { n: 1 })).toThrow(/KeyError/);
    expect(labelOr("tmode", "tram", "x")).toBe("tramwaj");
    expect(labelOr("tmode", "nope", "x")).toBe("x");
  });
  it("all languages have the same keys and fields as Polish", () => {
    const fields = (s: string) => [...s.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).sort().join(",");
    const dicts = Object.fromEntries(Object.keys(LANGUAGES).map((l) => [l, JSON.parse(JSON.stringify(locale(l))) as Record<string, string>]));
    for (const lang of Object.keys(LANGUAGES)) {
      expect(Object.keys(dicts[lang]), lang).toEqual(Object.keys(dicts.pl));
      for (const k of Object.keys(dicts.pl)) expect(fields(dicts[lang][k]), `${lang} ${k}`).toBe(fields(dicts.pl[k]));
    }
  });
});
