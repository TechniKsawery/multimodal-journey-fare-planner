import { describe, expect, it } from "vitest";
import { defaultProfile } from "../src/fares/model";
import { ProfileError, parseDiscountProfile } from "../src/fares/profile";

describe("parseDiscountProfile", () => {
  it("fills defaults and keeps valid fields", () => {
    const p = parseDiscountProfile({ age: 20, bahncard: "25", ztm_lublin_ulgowy: true, junk: "dropped" });
    expect(p).toEqual({ ...defaultProfile(), age: 20, bahncard: "25", ztm_lublin_ulgowy: true });
    expect("junk" in p).toBe(false);
  });

  it("accepts the Deutschlandticket flag (default false) and rejects a non-boolean", () => {
    expect(parseDiscountProfile({}).deutschlandticket).toBe(false);
    expect(parseDiscountProfile({ deutschlandticket: true, bahncard: "100" })).toMatchObject({ deutschlandticket: true, bahncard: "100" });
    expect(() => parseDiscountProfile({ deutschlandticket: "yes" })).toThrow(ProfileError);
  });

  it("rejects non-objects and wrong types", () => {
    for (const bad of [null, "x", 5, [], { age: "20" }, { age: 20.5 }, { age: -1 }, { age: 999 }, { hvv_dziecko: "yes" }, { bahncard: 25 }]) {
      expect(() => parseDiscountProfile(bad)).toThrow(ProfileError);
    }
  });

  it("does not let prototype pollution keys through", () => {
    const p = parseDiscountProfile(JSON.parse('{"__proto__": {"age": 3}, "constructor": 1}'));
    expect(p.age).toBeNull();
    expect(({} as Record<string, unknown>)["age"]).toBeUndefined();
  });
});
