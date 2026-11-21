// Data-consistency checks (port of tests/test_data_consistency.py, the parts that read only the JSON files):
// attractions, city cards and fare files. They run in the TypeScript CI without Python, so a bad data edit is
// caught even when only core/ is built. The "known debt" lists are copied from the Python test and shrink as the
// records get fixed (the tests insist that a fixed record is removed from the list).
import { describe, expect, it } from "vitest";
import attractionsFile from "../../data/attractions/attractions.json";
import cardsFile from "../../data/attractions/city_cards.json";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FARE_FILES = (import.meta as unknown as { glob: (p: string, o: object) => Record<string, Json> }).glob("../../data/fares/*.json", {
  import: "default",
  eager: true,
});

const CURRENCIES = new Set(["PLN", "EUR"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GROUPS = ["child_price", "student_price", "senior_price", "family_price"] as const;

// Records whose condition (age/status) is only in the text `label`, not in min_age/max_age/requires_status.
// Known debt: each needs the condition checked at the source (nothing is guessed). NEW records must be structured.
const KNOWN_UNSTRUCTURED_CONDITIONS = new Set([
  "berlin_olympiastadion.family_price",
  "berlin_alte_foersterei.family_price",
  "warszawa_pge_narodowy.family_price",
  "warszawa_muzeum_powstania.senior_price",
  "hamburg_st_michaelis.student_price",
  "hamburg_st_michaelis.family_price",
  "hamburg_speicherstadtmuseum.student_price",
  "hamburg_imm.student_price",
  "hamburg_imm.family_price",
  "hamburg_elbphilharmonie_plaza.student_price",
  "hamburg_hagenbeck.family_price",
  "hamburg_miniatur_wunderland.student_price",
  "munchen_fcbayern_erlebniswelt.student_price",
  "munchen_fcbayern_erlebniswelt.family_price",
  "munchen_deutsches_museum.student_price",
  "munchen_deutsches_museum.family_price",
  "munchen_residenz.student_price",
  "munchen_schloss_nymphenburg.student_price",
  "munchen_frauenkirche.student_price",
  "munchen_frauenkirche.family_price",
  "munchen_skylift_olympiapark.student_price",
  "munchen_skylift_olympiapark.senior_price",
  "munchen_hellabrunn.student_price",
  "munchen_hellabrunn.family_price",
  "munchen_hellabrunn.senior_price",
  "munchen_bier_oktoberfest_museum.student_price",
  "munchen_botanischer_garten.student_price",
  "koln_rheinenergiestadion.student_price",
  "koln_dom.student_price",
  "koln_triangle.student_price",
  "koln_schokoladenmuseum.student_price",
  "koln_schokoladenmuseum.family_price",
  "koln_schokoladenmuseum.senior_price",
  "wroclaw_panorama_raclawicka.student_price",
  "wroclaw_panorama_raclawicka.family_price",
  "wroclaw_hydropolis.student_price",
  "wroclaw_hydropolis.family_price",
  "poznan_termy_maltanskie.student_price",
  "poznan_termy_maltanskie.family_price",
  "poznan_brama_poznania.student_price",
  "poznan_brama_poznania.family_price",
  "poznan_nowe_zoo.student_price",
  "poznan_nowe_zoo.family_price",
  "poznan_fotoplastykon.student_price",
  "poznan_fotoplastykon.family_price",
  "poznan_rogalowe_muzeum.student_price",
  "poznan_palmiarnia.student_price",
]);
// Paid attractions marked price_verified without official_url. No new ones may be added.
const KNOWN_VERIFIED_WITHOUT_URL = new Set<string>();
// Fare files whose source URL is not in a `_zrodlo*` field (known gaps).
const KNOWN_FARE_FILES_WITHOUT_URL = new Set(["flixbus_fallback.json"]);

const ATTRACTIONS = (attractionsFile as unknown as { atrakcje: Json[] }).atrakcje;
const CARDS = (cardsFile as unknown as { karty: Json[] }).karty;
const ids = (items: Json[]): string[] => items.map((i) => i.id);
const startsHttp = (v: unknown): boolean => typeof v === "string" && v.startsWith("http");

describe("attractions data", () => {
  it("ids are unique", () => {
    expect(new Set(ids(ATTRACTIONS)).size).toBe(ATTRACTIONS.length);
  });

  it("base price, currency and source of a confirmed price", () => {
    for (const a of ATTRACTIONS) {
      expect(CURRENCIES.has(a.currency), a.id).toBe(true);
      expect(a.normal_price, a.id).toBeGreaterThanOrEqual(0);
      if (a.price_verified && a.normal_price > 0) {
        if (KNOWN_VERIFIED_WITHOUT_URL.has(a.id)) expect(startsHttp(a.official_url), `${a.id} has official_url now: remove it from KNOWN_VERIFIED_WITHOUT_URL`).toBe(false);
        else expect(startsHttp(a.official_url), `${a.id}: price_verified without official_url`).toBe(true);
      }
    }
  });

  it("discount prices have conditions and a source", () => {
    for (const a of ATTRACTIONS) {
      for (const group of GROUPS) {
        const gp: Json | undefined = a[group] ?? undefined;
        if (gp === undefined) continue;
        const where = `${a.id}.${group}`;
        expect(typeof gp.price === "number" && gp.price >= 0, where).toBe(true);
        expect(Boolean(gp.label), `${where}: no label`).toBe(true);
        const hasAge = (gp.min_age ?? null) !== null || (gp.max_age ?? null) !== null;
        const hasStatus = Boolean(gp.requires_status);
        const structured = group !== "child_price" && (hasAge || hasStatus);
        if (KNOWN_UNSTRUCTURED_CONDITIONS.has(where)) {
          expect(structured, `${where} is structured now: remove it from KNOWN_UNSTRUCTURED_CONDITIONS`).toBe(false);
        } else if (group === "child_price") {
          expect(hasAge, `${where}: child price without an age limit`).toBe(true);
        } else {
          expect(hasAge || hasStatus, `${where}: no age/status condition`).toBe(true);
        }
        if ((gp.min_age ?? null) !== null && (gp.max_age ?? null) !== null) expect(gp.min_age, where).toBeLessThanOrEqual(gp.max_age);
        // a reduced price of one person does not exceed the normal one (a family price is for the whole family)
        if (group !== "family_price" && a.price_verified) expect(gp.price, `${where}: reduced dearer than normal`).toBeLessThanOrEqual(a.normal_price);
        if (gp.price_verified) {
          expect(startsHttp(gp.source_url), `${where}: no source_url`).toBe(true);
          expect(ISO_DATE.test(gp.verified_date ?? ""), `${where}: no/invalid verified_date`).toBe(true);
        }
      }
    }
  });
});

describe("city cards data", () => {
  it("ids are unique", () => {
    expect(new Set(ids(CARDS)).size).toBe(CARDS.length);
  });

  it("a card confirmed to exist has a source URL and date", () => {
    for (const c of CARDS) {
      if (!c.existence_verified) continue;
      expect(startsHttp(c.existence_source_url), `${c.id}: no existence URL`).toBe(true);
      expect(ISO_DATE.test(c.existence_verified_date ?? ""), `${c.id}: no existence date`).toBe(true);
    }
  });

  it("variants have a currency and a positive price", () => {
    for (const c of CARDS) {
      expect(c.variants.length, `${c.id}: no variants`).toBeGreaterThan(0);
      for (const v of c.variants) {
        expect(CURRENCIES.has(v.currency), v.id).toBe(true);
        expect(v.price, v.id).toBeGreaterThan(0);
      }
    }
  });

  it("custom discounts point at existing attractions", () => {
    const known = new Set(ids(ATTRACTIONS));
    for (const c of CARDS) for (const aid of Object.keys(c.custom_discounts ?? {})) expect(known.has(aid), `${c.id}: unknown attraction ${aid}`).toBe(true);
  });
});

describe("fare files", () => {
  const entries = Object.entries(FARE_FILES).map(([path, data]) => [path.split("/").pop() as string, data] as const);

  it("sees the fare files", () => {
    expect(entries.length).toBeGreaterThan(30);
  });

  it("have a source URL and a single known currency", () => {
    for (const [name, data] of entries) {
      if ("waluta" in data) expect(CURRENCIES.has(data.waluta), name).toBe(true);
      const text = Object.keys(data)
        .filter((k) => k.startsWith("_zrodlo") || k === "source")
        .map((k) => String(data[k]))
        .join(" ");
      if (KNOWN_FARE_FILES_WITHOUT_URL.has(name)) expect(text.includes("http"), `${name} has a URL now: remove it from KNOWN_FARE_FILES_WITHOUT_URL`).toBe(false);
      else expect(text.includes("http"), `${name}: no source URL`).toBe(true);
    }
  });

  it("are dated and the reduced fare is not above the full one", () => {
    for (const [name, data] of entries) {
      if ("as_of" in data) expect(ISO_DATE.test(String(data.as_of)), `${name}: bad as_of`).toBe(true);
      for (const t of (data.bilety_czasowe ?? []) as Json[]) {
        if ("normalny" in t && "ulgowy" in t) expect(t.ulgowy, `${name}: reduced > normal`).toBeLessThanOrEqual(t.normalny);
      }
    }
  });
});
