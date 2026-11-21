// Inventory gate: every Python carrier and every data file must have a TypeScript counterpart (or a reasoned exception).
import { describe, expect, it } from "vitest";
import inventory from "../golden/inventory.json";
import { Carrier } from "../src/fares/model";

/** Data files that core/src does not read, with the reason. Adding a file here is a conscious decision. */
const NOT_USED_BY_CORE: Record<string, string> = {
  "data/fares/flixbus_calibration.json": "input of scripts/calibrate_flixbus.py only; the app uses flixbus_fallback.json",
  "data/fares/trilex_sachsen_gorlitz_drezno.json": "tariff data not wired into any calculator yet (Python does not read it either)",
  "data/fares/vbb_anschlusstarif_pl.json": "tariff data not wired into any calculator yet (Python does not read it either)",
  "data/fares/vbb_brandenburg_stadte.json": "tariff data not wired into any calculator yet (Python does not read it either)",
  "data/fares/vbb_regional_tarifstufen.json": "tariff data not wired into any calculator yet (Python does not read it either)",
  "data/fares/vvo_ostsachsen.json": "tariff data not wired into any calculator yet (Python does not read it either)",
  "data/flights/baggage_by_airline.json": "flights are out of scope of the port",
  "data/flights/cabin_baggage.json": "flights are out of scope of the port",
  "data/flights/extras_placeholder.json": "flights are out of scope of the port",
  "data/routing/airports.json": "flights are out of scope of the port",
};

// All TypeScript sources of core/src as text (Vite glob: no Node typings, no extra dependency).
const RAW = (import.meta as unknown as { glob: (p: string, o: object) => Record<string, string> }).glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});
const sources = (): string => Object.values(RAW).join("\n");

describe("port inventory", () => {
  it("has every carrier of the oracle with the same value", () => {
    expect({ ...Carrier }).toEqual(inventory.carriers);
  });

  it("sees the TypeScript sources", () => {
    expect(Object.keys(RAW).length).toBeGreaterThan(20);
    expect(sources()).toContain("data/fares/bahncard.json");
  });

  it("every data file is used by core/src or explicitly excepted", () => {
    const src = sources();
    const missing = inventory.data_files.filter((f) => !src.includes(f) && !(f in NOT_USED_BY_CORE));
    expect(missing).toEqual([]);
  });

  it("the exception list has no stale entries", () => {
    const src = sources();
    for (const f of Object.keys(NOT_USED_BY_CORE)) {
      expect(inventory.data_files).toContain(f);
      expect(src.includes(f)).toBe(false);
    }
  });
});
