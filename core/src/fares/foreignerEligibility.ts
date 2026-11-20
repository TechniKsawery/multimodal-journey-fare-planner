// Port of fares/foreigner_eligibility.py: informational warnings about whether a ticked discount
// really applies to a foreigner. Never changes a price; where a rule is not verified, no warning.
import { msg, type Msg } from "../i18n/msg";
import type { DiscountProfile } from "./model";

const PKP_STUDENT_CODES = new Set(["dzieci_mlodziez_szkolna_do_24_lat", "student_do_26_lat_doktorant_do_35_lat"]);

export function warningsFor(profile: DiscountProfile): Msg[] {
  const foreigner = profile.obywatelstwo !== null && profile.obywatelstwo !== "PL";
  if (!foreigner && !profile.legitymacja_zagraniczna) return [];

  const warnings: Msg[] = [];
  const outsideEu = profile.obywatelstwo === "poza_UE";
  if (foreigner && PKP_STUDENT_CODES.has(profile.pkp_ulga_kod)) {
    warnings.push(msg(outsideEu ? "foreign.pkp_non_eu" : "foreign.pkp_eu"));
  }
  // Recognition warnings concern only a FOREIGN student card, whatever the citizenship.
  const foreignCard = profile.legitymacja_zagraniczna;
  if (foreignCard && profile.ztm_warszawa_ulgowy) warnings.push(msg("foreign.warsaw"));
  if (foreignCard && profile.mpk_krakow_ulgowy) warnings.push(msg("foreign.krakow"));
  if (foreignCard && profile.ztm_poznan_ulgowy) warnings.push(msg("foreign.poznan"));
  if (foreignCard && profile.ztm_lublin_ulgowy) warnings.push(msg("foreign.lublin"));
  if (foreignCard && profile.mpk_wroclaw_ulgowy) warnings.push(msg("foreign.wroclaw"));
  if (foreigner && (profile.bvg_berlin_ulgowy || profile.vrr_dziecko)) warnings.push(msg("foreign.germany"));
  return warnings;
}
