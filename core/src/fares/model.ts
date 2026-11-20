// Port of fares/model.py. Field names stay snake_case ON PURPOSE: they are the same keys as the
// Python oracle, the golden vectors and the profile JSON stored in the browser, so nothing is
// renamed (and mis-mapped) along the way.

export type PriceType = "szacunek" | "oficjalna_taryfa";
export const PriceType = { ESTIMATE: "szacunek", OFFICIAL: "oficjalna_taryfa" } as const;

export const Carrier = {
  PKP_INTERCITY: "pkp_intercity",
  DB: "db",
  VRR: "vrr",
  FLIXBUS: "flixbus",
  ZTM_LUBLIN: "ztm_lublin",
  ZTM_WARSZAWA: "ztm_warszawa",
  MPK_KRAKOW: "mpk_krakow",
  ZTM_POZNAN: "ztm_poznan",
  MPK_WROCLAW: "mpk_wroclaw",
  BVG_BERLIN: "bvg_berlin",
  HVV: "hvv",
  MVV: "mvv",
  VRS_KOLN: "vrs_koln",
  POLREGIO_PODSTAWOWA: "polregio_taryfa_podstawowa",
  INTERNATIONAL_PL_DE: "international_pl_de",
  SKM_TROJMIASTO: "skm_trojmiasto",
  LKA_LODZ: "lka_lodz",
  KOLEJE_MALOPOLSKIE: "koleje_malopolskie",
  KOLEJE_MAZOWIECKIE: "koleje_mazowieckie",
  ZVON_GORLITZ: "zvon_gorlitz",
  KD_ZGORZELEC_GORLITZ: "kd_zgorzelec_gorlitz",
  BILET_GRANICZNY_ZASIEKI_FORST: "bilet_graniczny_zasieki_forst",
} as const;
export type Carrier = (typeof Carrier)[keyof typeof Carrier];

/** Profil ulg pasażera (see the long field comments in fares/model.py — the meaning is unchanged). */
export interface DiscountProfile {
  pkp_ulga_kod: string;
  bahncard: string | null;
  ztm_lublin_ulgowy: boolean;
  ztm_lublin_bezplatny: boolean;
  ztm_warszawa_ulgowy: boolean;
  ztm_warszawa_bezplatny: boolean;
  mpk_krakow_ulgowy: boolean;
  mpk_krakow_bezplatny: boolean;
  ztm_poznan_ulgowy: boolean;
  ztm_poznan_bezplatny: boolean;
  mpk_wroclaw_ulgowy: boolean;
  mpk_wroclaw_bezplatny: boolean;
  bvg_berlin_ulgowy: boolean;
  bvg_berlin_schwerbehindert: boolean;
  vrr_dziecko: boolean;
  hvv_dziecko: boolean;
  mvv_dziecko: boolean;
  vrs_koln_dziecko: boolean;
  schwerbehinderte_wertmarke_de: boolean;
  age: number | null;
  child_with_guardian: boolean;
  obywatelstwo: string | null;
  legitymacja_zagraniczna: boolean;
}

export function defaultProfile(): DiscountProfile {
  return {
    pkp_ulga_kod: "brak",
    bahncard: null,
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
    bvg_berlin_schwerbehindert: false,
    vrr_dziecko: false,
    hvv_dziecko: false,
    mvv_dziecko: false,
    vrs_koln_dziecko: false,
    schwerbehinderte_wertmarke_de: false,
    age: null,
    child_with_guardian: false,
    obywatelstwo: null,
    legitymacja_zagraniczna: false,
  };
}

export interface Segment {
  carrier: Carrier;
  origin: string;
  destination: string;
  distance_km: number | null;
  ride_duration_min: number | null;
  discounts: DiscountProfile;
  travel_date: string | null;
  distance_along_track: boolean;
  distance_source: string | null;
  german_portion_fraction: number | null;
  tariff_zone: string | null;
}

export function makeSegment(
  init: Pick<Segment, "carrier" | "origin" | "destination"> &
    Partial<Omit<Segment, "discounts">> & { discounts?: Partial<DiscountProfile> },
): Segment {
  return {
    distance_km: null,
    ride_duration_min: null,
    travel_date: null,
    distance_along_track: false,
    distance_source: null,
    german_portion_fraction: null,
    tariff_zone: null,
    ...init,
    discounts: { ...defaultProfile(), ...(init.discounts ?? {}) },
  };
}

export interface PriceEstimate {
  carrier: Carrier;
  amount: number;
  currency: string;
  price_type: PriceType;
  breakdown: Record<string, unknown>;
  notes: string;
}

/** Loosely typed view of a data/fares/*.json table. Shape is enforced by data/schemas in CI. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Table = Record<string, any>;
