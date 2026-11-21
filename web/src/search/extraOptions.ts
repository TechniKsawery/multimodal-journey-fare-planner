import pkpTable from "../../../data/fares/pkp_intercity.json";

export type Kind = "reduced" | "free" | "child" | "disabled";

/** Every boolean DiscountProfile field the user can set, with a language-neutral system name. */
export const BOOL_FIELDS: { key: string; name: string; kind: Kind }[] = [
  { key: "ztm_lublin_ulgowy", name: "ZTM Lublin", kind: "reduced" },
  { key: "ztm_lublin_bezplatny", name: "ZTM Lublin", kind: "free" },
  { key: "ztm_warszawa_ulgowy", name: "ZTM Warszawa", kind: "reduced" },
  { key: "ztm_warszawa_bezplatny", name: "ZTM Warszawa", kind: "free" },
  { key: "mpk_krakow_ulgowy", name: "MPK Kraków", kind: "reduced" },
  { key: "mpk_krakow_bezplatny", name: "MPK Kraków", kind: "free" },
  { key: "ztm_poznan_ulgowy", name: "ZTM Poznań", kind: "reduced" },
  { key: "ztm_poznan_bezplatny", name: "ZTM Poznań", kind: "free" },
  { key: "mpk_wroclaw_ulgowy", name: "MPK Wrocław", kind: "reduced" },
  { key: "mpk_wroclaw_bezplatny", name: "MPK Wrocław", kind: "free" },
  { key: "bvg_berlin_ulgowy", name: "BVG Berlin", kind: "reduced" },
  { key: "bvg_berlin_schwerbehindert", name: "BVG Berlin", kind: "disabled" },
  { key: "vrr_dziecko", name: "VRR", kind: "child" },
  { key: "hvv_dziecko", name: "HVV Hamburg", kind: "child" },
  { key: "mvv_dziecko", name: "MVV München", kind: "child" },
  { key: "vrs_koln_dziecko", name: "VRS Köln", kind: "child" },
  { key: "schwerbehinderte_wertmarke_de", name: "Wertmarke (DE)", kind: "disabled" },
  { key: "child_with_guardian", name: "", kind: "child" },
];

/** DiscountProfile fields that have a different control (or are derived), so no checkbox is needed. */
export const FIELDS_WITH_OTHER_CONTROL = [
  "pkp_ulga_kod", // select below
  "bahncard", // profile select
  "deutschlandticket", // profile checkbox
  "age", // profile input
  "legitymacja_zagraniczna", // derived from the ID country
  "obywatelstwo", // not offered: nationality is not asked
] as const;

/** PKP relief codes from the verified tariff table (code -> percent). */
export const PKP_CODES: string[] = Object.keys(
  (pkpTable as { ulgi_procent: Record<string, number> }).ulgi_procent,
);
