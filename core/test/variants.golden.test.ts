// Golden test: rail variants + search vs the Python oracle (tools/golden/generate_variants.py). The oracle ran against a
// synthetic routing world and RECORDED every request it made; here the same payloads are replayed through a fake client,
// so the test checks the requests (strings, times, query sizes) as well as the variants built from the answers.
import { describe, expect, it } from "vitest";
import golden from "../golden/variants.json";
import { defaultProfile } from "../src/fares/model";
import { msg } from "../src/i18n/msg";
import { round2 } from "../src/pyCompat";
import { MotisError } from "../src/routing/errors";
import { priceVerified, type Itinerary, type OtherDayVariant, type SkippedVariant } from "../src/routing/model";
import { MAX_WALK_SECONDS, type Raw } from "../src/routing/motis";
import { search } from "../src/routing/search";
import {
  generateVariants,
  localIso,
  makeRouteRequest,
  motisTime,
  viaHubDetourReason,
  type AlternativeStop,
  type RoutingClient,
} from "../src/routing/variants";
import type { StopRef } from "../src/routing/transitousClient";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const data = golden as unknown as Json;

/** Msg / Joined / plain values in the oracle's JSON shape. */
function textJson(v: unknown): unknown {
  if (typeof v === "number") return Math.round(v * 1e4) / 1e4;
  if (v === null || typeof v !== "object") return v;
  const o = v as Json;
  if (typeof o["key"] === "string" && "params" in o) {
    return { key: o["key"], params: Object.fromEntries(Object.entries(o["params"] as Json).map(([k, x]) => [k, textJson(x)])) };
  }
  if (Array.isArray(o["joined"])) return { joined: o["joined"].map(textJson), sep: o["sep"] };
  return v;
}

function itemJson(it: Itinerary): Json {
  return {
    name: textJson(it.variant_name),
    price: round2(it.total_price_pln),
    duration: round2(it.total_duration_min),
    transfers: it.num_transfers,
    legs: it.legs.map((pl) => [
      pl.leg.origin_name,
      pl.leg.destination_name,
      pl.leg.depart.getTime(),
      pl.leg.arrive.getTime(),
      pl.leg.mode,
      round2(pl.amount),
      pl.currency,
      priceVerified(pl),
      pl.leg.requires_walk,
    ]),
    warnings: it.transfer_warnings.map((w) => [w.after_leg_index, w.gap_minutes, w.infeasible]),
    safe_fallback: it.is_safe_fallback,
  };
}

/** The oracle's item JSON with its ISO datetimes turned into epoch ms (the instants are what matter). */
function expectedItem(j: Json): Json {
  return { ...j, legs: (j["legs"] as unknown[][]).map((l) => [l[0], l[1], Date.parse(l[2] as string), Date.parse(l[3] as string), ...l.slice(4)]) };
}

const skippedJson = (s: SkippedVariant): Json => ({ name: textJson(s.variant_name), reason: textJson(s.reason) });
const otherJson = (o: OtherDayVariant): Json => ({ item: itemJson(o.itinerary), date: o.date, requested: o.requested_date, offset: o.days_offset });
const expectedOther = (j: Json): Json => ({ ...j, item: expectedItem(j["item"]) });

const stopOf = (j: Json): string | StopRef => (typeof j === "string" ? j : (j as StopRef));
const alt = (j: Json): AlternativeStop => ({ label: j["label"], stop_id: stopOf(j["stop"]) });

function fakeClient(plans: Record<string, Raw>, requests: string[]): RoutingClient {
  return {
    async plan(from, to, time, opts = {}) {
      const key = `${from}|${to}|${time}|${opts.maxTransfers ?? 4}|${opts.numItineraries ?? "None"}`;
      requests.push(key);
      const payload = plans[key];
      if (!payload) throw new Error(`unexpected request: ${key}`);
      const count = ((payload["itineraries"] as unknown[]) ?? []).length + ((payload["direct"] as unknown[]) ?? []).length;
      if (count === 0) {
        throw new MotisError(msg("err.motis_no_itinerary", { origin: from, destination: to, time, minutes: Math.floor(MAX_WALK_SECONDS / 60) }));
      }
      return payload;
    },
    async findStopId(ref) {
      return `id:${ref.name}`;
    },
  };
}

describe("variants and search vs the oracle", () => {
  for (const c of data["cases"] as Json[]) {
    it(c["name"], async () => {
      const r = c["request"] as Json;
      const request = makeRouteRequest({
        origin_stop_id: r["origin_stop_id"],
        destination_stop_id: r["destination_stop_id"],
        origin_label: "Start",
        destination_label: "Cel",
        date: r["date"],
        departure_time: r["departure_time"],
        discounts: { ...defaultProfile(), ...(r["profile"] as object) },
      });
      expect(motisTime(request)).toBe(c["motis_time"]);

      const requests: string[] = [];
      const client = fakeClient(c["plans"], requests);
      const otherDay: OtherDayVariant[] = [];
      const { built, skipped } = await generateVariants(client, request, {
        mode: "extended",
        viaHubStops: (c["via"] as Json[]).map(alt),
        alternativeOriginStops: (c["alt_origin"] as Json[]).map(alt),
        alternativeDestinationStops: (c["alt_destination"] as Json[]).map(alt),
        otherDayOut: otherDay,
      });
      expect(built.map(itemJson)).toEqual((c["built"] as Json[]).map(expectedItem));
      expect(skipped.map(skippedJson)).toEqual(c["skipped"]);
      expect(otherDay.map(otherJson)).toEqual((c["other_day"] as Json[]).map(expectedOther));

      const result = await search(client, request, { mode: "extended" });
      const s = c["search"] as Json;
      expect(result.built.map(itemJson)).toEqual((s["built"] as Json[]).map(expectedItem));
      expect(result.skipped.map(skippedJson)).toEqual(s["skipped"]);
      expect(result.other_day.map(otherJson)).toEqual((s["other_day"] as Json[]).map(expectedOther));
      expect(Object.keys(result.recommendations).sort()).toEqual(Object.keys(s["recommendations"]).sort());
      for (const [k, v] of Object.entries(s["recommendations"] as Json)) expect(itemJson(result.recommendations[k])).toEqual(expectedItem(v));

      // exactly the requests the oracle made, nothing more
      expect([...new Set(requests)].sort()).toEqual(Object.keys(c["plans"]).sort());
    });
  }

  it("local time with the Warsaw offset (fold=0)", () => {
    for (const [date, time, want] of data["helpers"]["local_time"] as string[][]) expect(localIso(date, time)).toBe(want);
  });

  it("via-hub detour limit", () => {
    for (const [o, v, d, want] of data["helpers"]["detour"] as [[number, number], [number, number], [number, number], unknown][]) {
      expect(textJson(viaHubDetourReason(o, v, d))).toEqual(want);
    }
  });
});
