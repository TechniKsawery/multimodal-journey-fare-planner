"""Generate golden vectors for fares/ (every carrier calculator) from the Python oracle.

Output (core/golden/):
  fares.json       readable subset: full expected result (amount, price_type, breakdown, notes)
  fares.grid.json  wide grids (carrier x extras x values x profiles) + FNV-1a fingerprint per case

The TypeScript port must reproduce every case. Regenerate only when the Python logic or the
data/fares/*.json tables change on purpose:  python tools/golden/generate_fares.py
"""

import json

from golden_common import OUT_DIR, ROOT, canonical, dump, fnv1a64

from fares.calculator import estimate_price
from fares.model import Carrier, DiscountProfile, Segment

DATA = ROOT / "data" / "fares"
pkp = json.loads((DATA / "pkp_intercity.json").read_text(encoding="utf-8"))

PROFILES: list[dict] = [{}]
PROFILES += [{"pkp_ulga_kod": k} for k in pkp["ulgi_procent"]]
PROFILES += [{"pkp_ulga_kod": "nieznany_kod"}]
PROFILES += [{"bahncard": b} for b in ("25", "50", "100", "75")]
BOOL_FLAGS = [
    "ztm_lublin_ulgowy",
    "ztm_lublin_bezplatny",
    "ztm_warszawa_ulgowy",
    "ztm_warszawa_bezplatny",
    "mpk_krakow_ulgowy",
    "mpk_krakow_bezplatny",
    "ztm_poznan_ulgowy",
    "ztm_poznan_bezplatny",
    "mpk_wroclaw_ulgowy",
    "mpk_wroclaw_bezplatny",
    "bvg_berlin_ulgowy",
    "bvg_berlin_schwerbehindert",
    "vrr_dziecko",
    "hvv_dziecko",
    "mvv_dziecko",
    "vrs_koln_dziecko",
    "schwerbehinderte_wertmarke_de",
]
PROFILES += [{f: True} for f in BOOL_FLAGS]
PROFILES += [{"ztm_warszawa_ulgowy": True, "ztm_warszawa_bezplatny": True}]
PROFILES += [{"mpk_wroclaw_ulgowy": True, "mpk_wroclaw_bezplatny": True}]
for age in (0, 3, 4, 5, 6, 7, 8, 10, 14, 15, 17, 18, 21, 24, 26, 27, 30, 64, 65, 69, 70, 80):
    PROFILES.append({"age": age})
for age in (5, 6, 10, 14, 15):
    PROFILES.append({"age": age, "child_with_guardian": True})
PROFILES += [
    {"age": 10, "bahncard": "25"},
    {"age": 20, "bahncard": "50"},
    {"age": 20, "bahncard": "25", "pkp_ulga_kod": "student_do_26_lat"},
    {"age": 12, "pkp_ulga_kod": "dzieci_mlodziez_szkolna_do_24_lat", "child_with_guardian": True},
    {"obywatelstwo": "UE", "legitymacja_zagraniczna": True},
]


def table_bounds(*files: str) -> list[float]:
    """Every km boundary in the carrier's own tables (and its neighbours): band edges are where ports break."""
    out: set[float] = set()

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ("do_km", "od_km") and isinstance(v, (int, float)):
                    out.update({v - 0.01, float(v), v + 0.01, v + 0.5, v + 0.99})
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    for f in files:
        walk(json.loads((DATA / f).read_text(encoding="utf-8")))
    return sorted({round(x, 2) for x in out if x >= 0})


BASE_KM = [0, 0.4, 1, 4.5, 5.4, 10, 49.99, 50, 120.5, 200, 337.2, 520, 521, 999.9, 1000, 1001, 2500]
MINUTES = [0, 1, 2.5, 10, 19.5, 20, 21, 30, 40, 45, 60, 75, 90, 120, 180, 300, 1000]

C = Carrier
# carrier -> (axis field, extra table files whose band edges become test values)
AXES = {
    C.PKP_INTERCITY: ("distance_km", ["pkp_intercity.json"]),
    C.DB: ("distance_km", ["db_flexpreis.json"]),
    C.VRR: ("distance_km", []),
    C.FLIXBUS: ("distance_km", []),
    C.POLREGIO_PODSTAWOWA: ("distance_km", ["polregio_taryfa_podstawowa.json"]),
    C.SKM_TROJMIASTO: ("distance_km", ["skm_trojmiasto.json"]),
    C.KOLEJE_MALOPOLSKIE: ("distance_km", ["koleje_malopolskie.json"]),
    C.KOLEJE_MAZOWIECKIE: ("distance_km", ["koleje_mazowieckie.json"]),
    C.INTERNATIONAL_PL_DE: ("distance_km", ["international_pl_de.json"]),
    C.ZTM_LUBLIN: ("ride_duration_min", []),
    C.ZTM_WARSZAWA: ("ride_duration_min", []),
    C.MPK_KRAKOW: ("ride_duration_min", []),
    C.ZTM_POZNAN: ("ride_duration_min", []),
    C.MPK_WROCLAW: ("ride_duration_min", []),
    C.BVG_BERLIN: ("ride_duration_min", []),
    C.LKA_LODZ: ("ride_duration_min", []),
    C.HVV: (None, []),
    C.MVV: (None, []),
    C.VRS_KOLN: (None, []),
    C.ZVON_GORLITZ: (None, []),
    C.KD_ZGORZELEC_GORLITZ: (None, []),
    C.BILET_GRANICZNY_ZASIEKI_FORST: (None, []),
}
assert set(AXES) == set(Carrier), "every carrier needs a golden axis"

COMMON_KEYS = {"age", "child_with_guardian"}
RELEVANT = {
    C.PKP_INTERCITY: {"pkp_ulga_kod"},
    C.DB: {"bahncard"},
    C.VRR: {"vrr_dziecko"},
    C.FLIXBUS: set(),
    C.POLREGIO_PODSTAWOWA: {"pkp_ulga_kod"},
    C.SKM_TROJMIASTO: {"pkp_ulga_kod"},
    C.KOLEJE_MALOPOLSKIE: {"pkp_ulga_kod"},
    C.KOLEJE_MAZOWIECKIE: {"pkp_ulga_kod"},
    C.INTERNATIONAL_PL_DE: {"bahncard"},
    C.ZTM_LUBLIN: {"ztm_lublin_ulgowy", "ztm_lublin_bezplatny"},
    C.ZTM_WARSZAWA: {"ztm_warszawa_ulgowy", "ztm_warszawa_bezplatny"},
    C.MPK_KRAKOW: {"mpk_krakow_ulgowy", "mpk_krakow_bezplatny"},
    C.ZTM_POZNAN: {"ztm_poznan_ulgowy", "ztm_poznan_bezplatny"},
    C.MPK_WROCLAW: {"mpk_wroclaw_ulgowy", "mpk_wroclaw_bezplatny"},
    C.BVG_BERLIN: {"bvg_berlin_ulgowy", "bvg_berlin_schwerbehindert"},
    C.LKA_LODZ: {"pkp_ulga_kod"},
    C.HVV: {"hvv_dziecko", "schwerbehinderte_wertmarke_de"},
    C.MVV: {"mvv_dziecko", "schwerbehinderte_wertmarke_de"},
    C.VRS_KOLN: {"vrs_koln_dziecko", "schwerbehinderte_wertmarke_de"},
    C.ZVON_GORLITZ: set(),
    C.KD_ZGORZELEC_GORLITZ: set(),
    C.BILET_GRANICZNY_ZASIEKI_FORST: set(),
}


def extras_for(carrier: Carrier) -> list[dict]:
    if carrier in (
        C.POLREGIO_PODSTAWOWA,
        C.SKM_TROJMIASTO,
        C.KOLEJE_MALOPOLSKIE,
        C.KOLEJE_MAZOWIECKIE,
    ):
        return [
            {},
            {"distance_along_track": True, "distance_source": "geometria MOTIS"},
            {"distance_along_track": True},
        ]
    if carrier is C.INTERNATIONAL_PL_DE:
        return [
            {},
            {"german_portion_fraction": 0.0},
            {"german_portion_fraction": 0.4},
            {"german_portion_fraction": 1.0},
            {"german_portion_fraction": 1.7},
        ]
    if carrier is C.BVG_BERLIN:
        return [{}, {"tariff_zone": "ABC"}]
    if carrier in (C.ZTM_LUBLIN, C.ZTM_WARSZAWA, C.MPK_KRAKOW, C.ZTM_POZNAN):
        return [
            {},
            {"travel_date": "2026-06-15"},
            {"travel_date": "2026-09-30"},
            {"travel_date": "2026-10-01"},
            {"travel_date": "2026-12-31"},
            {"travel_date": "not-a-date"},
        ]
    return [{}]


def values_for(carrier: Carrier) -> list:
    field, files = AXES[carrier]
    if field is None:
        return [None]
    base = BASE_KM if field == "distance_km" else MINUTES
    return [None] + sorted(set(base) | set(table_bounds(*files)))


def profiles_for(carrier: Carrier) -> list[dict]:
    allowed = RELEVANT[carrier] | COMMON_KEYS
    return [p for p in PROFILES if set(p) <= allowed]


def run(carrier: Carrier, field: str | None, value, extra: dict, profile: dict) -> dict:
    kwargs = dict(extra)
    if field:
        kwargs[field] = value
    seg = Segment(
        carrier=carrier, origin="A", destination="B", discounts=DiscountProfile(**profile), **kwargs
    )
    try:
        r = estimate_price(seg)
        return {
            "ok": {
                "amount": r.amount,
                "currency": r.currency,
                "price_type": r.price_type,
                "breakdown": r.breakdown,
                "notes": r.notes,
                "carrier": r.carrier,
            }
        }
    except ValueError as e:
        return {"error": str(e)}
    except Exception:  # noqa: BLE001 - any other failure is just "not a ValueError" for the port
        return {"error": "<non-ValueError>"}


def main() -> None:
    readable, grids = [], []
    for carrier in Carrier:
        # FlixBus with travel_date would call the live (unofficial) API; the app uses only the fallback.
        extras = [{}] if carrier is C.FLIXBUS else extras_for(carrier)
        field, _ = AXES[carrier]
        values, profiles = values_for(carrier), profiles_for(carrier)
        hashes = []
        for extra in extras:
            for value in values:
                for profile in profiles:
                    hashes.append(fnv1a64(canonical(run(carrier, field, value, extra, profile))))
        grids.append(
            {
                "carrier": carrier.value,
                "field": field,
                "extras": extras,
                "values": values,
                "profiles": profiles,
                "hashes": hashes,
            }
        )
        # Readable subset with full expected output (the human-checkable specification).
        pick_values = values[:: max(1, len(values) // 6)] if len(values) > 1 else values
        pick_profiles = profiles[:: max(1, len(profiles) // 6)]
        for extra in extras[:2]:
            for value in pick_values:
                for profile in pick_profiles:
                    readable.append(
                        {
                            "carrier": carrier.value,
                            "field": field,
                            "extra": extra,
                            "value": value,
                            "profile": profile,
                            "expect": run(carrier, field, value, extra, profile),
                        }
                    )
    dump(OUT_DIR / "fares.json", readable)
    dump(OUT_DIR / "fares.grid.json", grids)
    print(f"readable cases: {len(readable)}, grid cases: {sum(len(g['hashes']) for g in grids)}")


if __name__ == "__main__":
    main()
