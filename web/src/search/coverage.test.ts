import { describe, expect, it } from "vitest";
import { buildResults } from "./adapt";
import { referenceRoutes } from "./fixtures/routes";

// Price coverage floor on five reference relations (SYNTHETIC itineraries, see fixtures/routes.ts).
// Before the switch to core/routing/pricing the adapter in web/ priced 2/3, 1/2, 0/1, 2/3, 0/2 legs.
const EXPECT: Record<string, [priced: number, total: number]> = {
  "Lublin-Gelsenkirchen": [3, 3],
  "Lublin-Berlin": [2, 2],
  "Warszawa-Berlin": [1, 1],
  "Krakow-Hamburg": [3, 3],
  "Wroclaw-Drezno": [0, 2], // KD (percent-based relief) and trilex have no confirmed tariff yet
};

describe("price coverage on reference routes", () => {
  it.each(Object.entries(EXPECT))("%s", (name, [priced, total]) => {
    const [r] = buildResults([referenceRoutes[name]], { status: "student", idCountry: "pl", age: 21, bahncard: "none" });
    expect([r.pricedLegs, r.totalLegs]).toEqual([priced, total]);
    // an unconfirmed leg never carries an amount
    for (const l of r.legs) if (l.status === "unconfirmed") expect(l.price).toBeUndefined();
  });
});
