// Golden tests for the attractions module: city detection, catalogue, working-note filter,
// localized texts, best price per profile and the city-card calculator (oracle: attractions/service.py).
import { describe, expect, it } from "vitest";
import golden from "../golden/attractions.json";
import {
  bestPriceForAttraction,
  evaluateCityCards,
  getAllAttractions,
  getAllCityCards,
  getAttractions,
  getCityCards,
  hasWorkingNote,
  isClosed,
  localizedDescription,
  makeProfile,
  normalizeCity,
  priceFromNote,
  publicText,
  suggestBestCityCard,
  type DiscountProfile,
} from "../src/attractions/service";
import { canonical, firstDiff, fnv1a64, productCases } from "./golden";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const data = golden as unknown as Json;

const DOC_SETS = data.doc_sets as { doc_type: string; issuing_country: string }[][];
function profiles(): (DiscountProfile | null)[] {
  const out: (DiscountProfile | null)[] = [null];
  for (const age of [null, 5, 12, 17, 26, 67])
    for (const is_student of [false, true])
      for (const is_senior of [false, true])
        for (const docs of DOC_SETS) out.push(makeProfile({ age, is_student, is_senior, documents: docs.map((d) => ({ ...d })) }));
  return out;
}
const PROFILES = profiles();
const EVAL_PROFILES = PROFILES.filter((_, i) => i % Math.max(1, Math.floor(PROFILES.length / 24)) === 0);

const attractions = getAllAttractions();
const byId = new Map(attractions.map((a) => [a.id, a]));
const grid = (name: string) => (data.grids as Json[]).find((g) => g.name === name)!;

describe("catalogue", () => {
  it("loads attractions exactly like the oracle", () => {
    expect(firstDiff(attractions, data.attractions)).toBeNull();
  });
  it("loads city cards exactly like the oracle", () => {
    expect(firstDiff(getAllCityCards(), data.city_cards)).toBeNull();
  });
  it("only cards with confirmed existence, per city", () => {
    for (const [city, ids] of Object.entries(data.city_cards_by_city as Json)) {
      expect(getCityCards(city === "null" ? null : city).map((c) => c.id)).toEqual(ids);
    }
  });
  it("filters by city and category", () => {
    for (const f of data.attractions_filters as Json[]) {
      expect(getAttractions(f.city, f.category, true).map((a) => a.id)).toEqual(f.ids);
    }
  });
  it("closure follows closed_until", () => {
    for (const [id, d, closed] of data.closed as [string, string, boolean][]) expect(isClosed(byId.get(id)!, d)).toBe(closed);
    const firstFive = attractions.slice(0, 5).flatMap((a) => ["2020-01-01", "2028-12-30", "2028-12-31", "2029-01-01", "2026-11-20"].map((d) => isClosed(a, d)));
    expect(firstFive).toEqual(data.closed_none);
    expect(getAttractions("koln", null, false, "2026-11-20").some((a) => a.id === "koln_wallraf_richartz")).toBe(false);
    expect(getAttractions("koln", null, false, "2029-01-01").some((a) => a.id === "koln_wallraf_richartz")).toBe(true);
  });
});

describe("city detection", () => {
  it("matches the oracle", () => {
    for (const [q, want] of data.city_queries as [string | null, string | null][]) expect(normalizeCity(q), String(q)).toBe(want);
  });
});

describe("working-note filter", () => {
  it("matches the oracle", () => {
    for (const [text, note, pub] of data.texts as [string, boolean, string][]) {
      expect(hasWorkingNote(text), text).toBe(note);
      expect(publicText(text), text).toBe(pub);
    }
  });
});

function checkGrid(name: string, fn: (c: Json) => unknown): void {
  const g = grid(name);
  const cases = productCases(g.axes);
  expect(cases.length).toBe(g.hashes.length);
  const bad: string[] = [];
  cases.forEach((c, i) => {
    const got = fn(c);
    if (fnv1a64(canonical(got)) !== g.hashes[i]) bad.push(`${JSON.stringify(c)} -> ${canonical(got)}`);
  });
  expect(bad.slice(0, 3)).toEqual([]);
}

describe("grids (fingerprints)", () => {
  it("localized descriptions and price notes", () =>
    checkGrid("localized", (c) => ({
      d: localizedDescription(byId.get(c.attraction)!, c.lang),
      n: priceFromNote(byId.get(c.attraction)!, c.lang),
    })));
  it("best price per profile", () =>
    checkGrid("best_price", (c) => {
      const [price, label, gp] = bestPriceForAttraction(byId.get(c.attraction)!, PROFILES[c.profile as number]);
      return { price, label, gp };
    }));
  it("city-card evaluation and best suggestion", () => {
    expect(PROFILES.length).toBe(data.profile_count);
    expect(EVAL_PROFILES.length).toBe(data.eval_profile_count);
    const subsets = data.subsets as Record<string, Record<string, string[]>>;
    checkGrid("evaluate", (c) => {
      const sel = ((c.subset === "mixed" ? data.mixed : subsets[c.city as string][c.subset as string]) as string[]).map((i) => byId.get(i)!);
      const p = EVAL_PROFILES[c.profile as number];
      const best = suggestBestCityCard(c.city as string, sel, c.transit as number, p);
      return { evals: evaluateCityCards(c.city as string, sel, c.transit as number, p), best };
    });
  });
});

describe("readable city-card evaluation", () => {
  it("Kraków for three profiles", () => {
    for (const r of data.readable_eval as Json[]) {
      const sel = (r.ids as string[]).map((i) => byId.get(i)!);
      const p = r.profile === null ? null : makeProfile(r.profile);
      expect(firstDiff(evaluateCityCards("krakow", sel, r.transit, p), r.evals)).toBeNull();
    }
  });
});
