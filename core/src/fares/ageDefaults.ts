// Port of fares/age_defaults.py: default discounts derived from a passenger's age.
// Students and seniors are NOT inferred from age alone (they need a document); the user picks them.
import type { DiscountProfile } from "./model";

export type AgeDefaults = Pick<
  DiscountProfile,
  | "pkp_ulga_kod"
  | "ztm_lublin_ulgowy"
  | "ztm_lublin_bezplatny"
  | "ztm_warszawa_ulgowy"
  | "ztm_warszawa_bezplatny"
  | "mpk_krakow_ulgowy"
  | "mpk_krakow_bezplatny"
  | "ztm_poznan_ulgowy"
  | "ztm_poznan_bezplatny"
  | "mpk_wroclaw_ulgowy"
  | "mpk_wroclaw_bezplatny"
  | "bvg_berlin_ulgowy"
  | "vrr_dziecko"
  | "hvv_dziecko"
  | "mvv_dziecko"
  | "vrs_koln_dziecko"
>;

export function defaultDiscountsForAge(age: number | null): AgeDefaults {
  if (age === null) {
    return {
      pkp_ulga_kod: "brak",
      ztm_lublin_ulgowy: false,
      ztm_lublin_bezplatny: false,
      ztm_warszawa_ulgowy: false,
      ztm_warszawa_bezplatny: false,
      mpk_krakow_ulgowy: false,
      mpk_krakow_bezplatny: false,
      ztm_poznan_ulgowy: false,
      ztm_poznan_bezplatny: false,
      mpk_wroclaw_ulgowy: false,
      mpk_wroclaw_bezplatny: false,
      bvg_berlin_ulgowy: false,
      vrr_dziecko: false,
      hvv_dziecko: false,
      mvv_dziecko: false,
      vrs_koln_dziecko: false,
    };
  }
  const pkp = age <= 4 ? "dzieci_do_4_lat" : age < 18 ? "dzieci_mlodziez_szkolna_do_24_lat" : "brak";
  const child = 6 <= age && age <= 14;
  return {
    pkp_ulga_kod: pkp,
    ztm_lublin_ulgowy: age < 18,
    ztm_lublin_bezplatny: age >= 65 || age <= 14,
    ztm_warszawa_ulgowy: age < 18,
    ztm_warszawa_bezplatny: age >= 70,
    mpk_krakow_ulgowy: age < 18,
    mpk_krakow_bezplatny: age >= 70,
    ztm_poznan_ulgowy: age < 18,
    ztm_poznan_bezplatny: age >= 70,
    mpk_wroclaw_ulgowy: age < 18,
    mpk_wroclaw_bezplatny: age <= 7 || age <= 21 || age >= 65,
    bvg_berlin_ulgowy: age < 18,
    vrr_dziecko: child,
    hvv_dziecko: child,
    mvv_dziecko: child,
    vrs_koln_dziecko: child,
  };
}
