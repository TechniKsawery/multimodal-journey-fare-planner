// Golden tests for BahnCard suggestions, age defaults, eligibility texts, foreigner warnings, currency.
import { describe, expect, it } from "vitest";
import misc from "../golden/misc.json";
import { convert, normalizeCurrency, toPln } from "../src/common/currency";
import { defaultDiscountsForAge } from "../src/fares/ageDefaults";
import { suggestBahncard } from "../src/fares/cards";
import { ELIGIBILITY, eligibilityFor, explainTicket } from "../src/fares/eligibilityInfo";
import { warningsFor } from "../src/fares/foreignerEligibility";
import { Carrier, defaultProfile, type DiscountProfile } from "../src/fares/model";
import { canonical, capture, fnv1a64, productCases } from "./golden";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const data = misc as unknown as Json;

const cardsCase = (c: Json) =>
  suggestBahncard(c.distance_km, c.journeys_per_year, c.age, c.reference_date, c.existing_bahncard);
const currencyCase = (c: Json) => ({
  convert: convert(c.amount, c.from, c.to),
  to_pln: toPln(c.amount, c.from),
  normalize: normalizeCurrency(c.from),
});
const GRID_FNS: Record<string, (c: Json) => unknown> = { cards: cardsCase, currency: currencyCase };

describe("grids (fingerprints)", () => {
  for (const grid of data.grids as Json[]) {
    it(`${grid.name}: ${grid.hashes.length} cases`, () => {
      const cases = productCases(grid.axes);
      expect(cases.length).toBe(grid.hashes.length);
      const bad: string[] = [];
      cases.forEach((c, i) => {
        const got = capture(() => GRID_FNS[grid.name](c));
        if (fnv1a64(canonical(got)) !== grid.hashes[i]) bad.push(`${JSON.stringify(c)} -> ${canonical(got)}`);
      });
      expect(bad.slice(0, 3)).toEqual([]);
    });
  }
});

describe("BahnCard suggestions (full output)", () => {
  it("matches the oracle", () => {
    for (const c of data.readable_cards as Json[]) {
      expect(canonical(capture(() => cardsCase(c.in)))).toBe(canonical(c.expect));
    }
  });
});

describe("age defaults", () => {
  it("matches the oracle for ages -3..120 and null", () => {
    for (const c of data.age_defaults as Json[]) {
      expect(canonical(defaultDiscountsForAge(c.age))).toBe(canonical(c.expect));
    }
  });
});

describe("eligibility", () => {
  it("has the same entries as the oracle", () => {
    for (const [carrier, vals] of Object.entries(data.eligibility as Json)) {
      expect(canonical(eligibilityFor(carrier as Carrier))).toBe(canonical(vals));
    }
    expect(Object.keys(ELIGIBILITY).length).toBe(Object.keys(data.eligibility).length);
    for (const carrier of data.eligibility_missing as string[]) expect(eligibilityFor(carrier as Carrier)).toBeNull();
    expect(Object.values(Carrier).length).toBe(Object.keys(data.eligibility).length + data.eligibility_missing.length);
  });
  it("explainTicket", () => {
    for (const c of data.explain_ticket as Json[]) expect(explainTicket(c.in)).toBe(c.expect);
  });
});

describe("foreigner warnings", () => {
  it("matches the oracle on all 216 profiles", () => {
    for (const c of data.foreigner as Json[]) {
      const profile: DiscountProfile = { ...defaultProfile(), ...c.profile };
      expect(canonical(warningsFor(profile))).toBe(canonical(c.expect));
    }
  });
});
