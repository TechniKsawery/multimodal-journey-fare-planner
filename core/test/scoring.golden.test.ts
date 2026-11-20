// Golden tests for routing/model + transfers + scoring: the TS port must reproduce, on seeded
// synthetic scenarios, every itinerary metric, every transfer warning and every recommendation.
import { describe, expect, it } from "vitest";
import scoring from "../golden/scoring.json";
import { msg, type Msg } from "../src/i18n/msg";
import {
  itineraryPriceVerified,
  isInfeasible,
  isRisky,
  makeLeg,
  makePricedLeg,
  numCarriers,
  numRiskyTransfers,
  priceKnown,
  priceStatus,
  priceVerified,
  pricePerHour,
  unverifiedLabel,
  valueScore,
  type Itinerary,
  type Leg,
  type PricedLeg,
} from "../src/routing/model";
import { RECOMMENDATION_LABELS, buildItinerary, cheaperUnverified, pickRecommendations, priceRankingNote } from "../src/routing/scoring";
import { capture, canonical, firstDiff } from "./golden";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const data = scoring as unknown as Json;

const toLeg = (j: Json): Leg => makeLeg({ ...j, depart: new Date(j.depart), arrive: new Date(j.arrive) } as never);
const toPriced = (j: Json): PricedLeg => makePricedLeg({ ...j, leg: toLeg(j.leg) } as never);

function msgJson(m: Msg | null): unknown {
  if (m === null) return null;
  return { key: m.key, params: Object.fromEntries(Object.entries(m.params).map(([k, v]) => [k, isMsg(v) ? msgJson(v) : v])) };
}
const isMsg = (v: unknown): v is Msg => typeof v === "object" && v !== null && "key" in v && "params" in v;

function itineraryJson(it: Itinerary): Json {
  return {
    variant_name: it.variant_name,
    total_price_pln: it.total_price_pln,
    total_price_pln_high: it.total_price_pln_high,
    total_duration_min: it.total_duration_min,
    num_transfers: it.num_transfers,
    price_verified: itineraryPriceVerified(it),
    price_status: priceStatus(it),
    is_infeasible: isInfeasible(it),
    is_risky: isRisky(it),
    price_per_hour: it.total_duration_min > 0 ? pricePerHour(it) : "inf",
    num_carriers: numCarriers(it),
    num_risky_transfers: numRiskyTransfers(it),
    value_score: valueScore(it),
    is_safe_fallback: it.is_safe_fallback,
    legs_flags: it.legs.map((pl) => [priceKnown(pl), priceVerified(pl), unverifiedLabel(pl)]),
    transfer_warnings: it.transfer_warnings.map((w) => ({
      after_leg_index: w.after_leg_index,
      gap_minutes: w.gap_minutes,
      minimum_required_minutes: w.minimum_required_minutes,
      reason: msgJson(w.reason),
      infeasible: w.infeasible,
    })),
  };
}

describe("scoring golden scenarios", () => {
  it("labels are identical", () => {
    expect(RECOMMENDATION_LABELS).toEqual(data.labels);
  });
  it("empty variant error", () => {
    expect(capture(() => buildItinerary("x", []))).toEqual({ error: data.empty_variant_error });
  });
  it(`reproduces all ${data.scenarios.length} scenarios`, () => {
    const failures: string[] = [];
    for (const [n, sc] of (data.scenarios as Json[]).entries()) {
      const its = (sc.variants_in as Json[][]).map((legs, k) => buildItinerary(`v${k}`, legs.map(toPriced)));
      const expect_ = sc.expect as Json;
      const snapshot = its.map(itineraryJson); // before pickRecommendations flips is_safe_fallback, like the oracle
      const rec = capture(() => pickRecommendations(its));
      const got: Json = {
        variants: snapshot,
        recommendations: null,
        error: null,
        notes: {},
        cheaper_unverified: {},
      };
      if ("error" in (rec as Json)) got.error = (rec as Json).error;
      else {
        const r = (rec as Json).ok as Record<string, Itinerary>;
        got.recommendations = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.variant_name]));
        got.variants_after = its.map((i) => i.is_safe_fallback);
        for (const [key, chosen] of Object.entries(r)) {
          got.notes[key] = msgJson(priceRankingNote(key, chosen, its));
          if (key === "najtansza" || key === "najtansza_bezpieczna") {
            got.cheaper_unverified[key] = cheaperUnverified(its, chosen).map((i) => i.variant_name);
          }
        }
      }
      // is_safe_fallback in "variants" is set by pickRecommendations in the oracle only for non-infeasible ones
      if (canonical(got) !== canonical(expect_)) {
        failures.push(`scenario ${n}`);
        if (failures.length === 1) failures.push(firstDiff(got, expect_) ?? "");
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("Msg helper", () => {
  it("builds key + params", () => {
    expect(msg("a", { n: 1 })).toEqual({ key: "a", params: { n: 1 } });
  });
});
