// Golden test: place aliases vs the Python oracle (tools/golden/generate_places.py).
import { describe, expect, it } from "vitest";
import golden from "../golden/places.json";
import { LANGUAGES, aliasNames, findCity, fold, loadCities, localQuery, localizeName, placeText, searchNames } from "../src/places/aliases";
import { canonical, firstDiff, fnv1a64 } from "./golden";

const SHAPES = golden.shapes as string[];
const LANGS = golden.languages as (string | null)[];
const shape = (s: string, n: string): string => s.replace("{}", () => n);

function inputs(): string[] {
  const names = loadCities().flatMap((c) => searchNames(c));
  const out: string[] = [];
  for (const n of new Set(names)) {
    for (const s of SHAPES) out.push(shape(s, n));
    out.push(n.toUpperCase(), n.toLowerCase());
  }
  out.push(...(golden.extra_texts as string[]));
  return [...new Set(out)];
}

function row(text: string): unknown[] {
  const city = findCity(text);
  return [
    fold(text),
    city ? city.key : null,
    localQuery(text),
    LANGS.map((l) => localizeName(text, l)),
    LANGS.map((l) => placeText(text, l)),
    placeText(text, "en", "{local} -> {shown}"),
  ];
}

describe("place aliases vs the oracle", () => {
  it("named cases", () => {
    for (const n of golden.named as unknown as { text: string; result: unknown[] }[]) {
      expect(firstDiff(row(n.text), n.result)).toBeNull();
    }
  });

  it("every input has the oracle's fingerprint", () => {
    const rows = inputs().map(row);
    expect(rows.length).toBe(golden.count);
    expect(fnv1a64(canonical(rows))).toBe(golden.hash);
    expect(fnv1a64(canonical(aliasNames()))).toBe(golden.alias_names_hash);
    expect(loadCities().map((c) => c.key)).toEqual(golden.city_keys);
  });

  it("covers the six interface languages", () => {
    expect([...LANGUAGES]).toEqual(["pl", "en", "de", "es", "fr", "nl"]);
  });
});
