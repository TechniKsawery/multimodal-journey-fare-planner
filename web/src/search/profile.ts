import { defaultDiscountsForAge } from "../../../core/src/fares/ageDefaults";
import { defaultProfile, type DiscountProfile } from "../../../core/src/fares/model";
import type { Profile } from "../types";

export const PKP_STUDENT_CODE = "student_do_26_lat_doktorant_do_35_lat";
export const PKP_PUPIL_CODE = "dzieci_mlodziez_szkolna_do_24_lat";

/** UI profile -> core discount profile. Only reliefs that are certain are switched on. */
/** Defaults derived from age, status and ID country (no manual choices). */
export function baseDiscountProfile(p: Profile): DiscountProfile {
  const age = Number.isFinite(p.age) ? p.age : null;
  const out: DiscountProfile = { ...defaultProfile(), ...defaultDiscountsForAge(age), age };
  out.bahncard = p.bahncard === "none" ? null : p.bahncard;
  out.deutschlandticket = p.deutschlandticket === true;
  if (p.idCountry === "de" && p.status !== "none") {
    // A German ID is not an accepted basis for the Polish statutory relief (not verified) -> none.
    out.legitymacja_zagraniczna = true;
    out.pkp_ulga_kod = "brak";
  } else if (p.status === "student") {
    out.pkp_ulga_kod = age !== null && age <= 26 ? PKP_STUDENT_CODE : "brak";
  } else if (p.status === "pupil") {
    out.pkp_ulga_kod = age !== null && age <= 24 ? PKP_PUPIL_CODE : "brak";
  }
  return out;
}

/** Defaults plus the manual choices from "More options" (known fields with the right type only). */
export function toDiscountProfile(p: Profile): DiscountProfile {
  const out = baseDiscountProfile(p);
  const target = out as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(p.overrides ?? {})) {
    if (k in target && typeof target[k] === typeof v && !["age", "bahncard", "obywatelstwo"].includes(k)) target[k] = v;
  }
  return out;
}
