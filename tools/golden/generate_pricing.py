"""Golden vectors for routing/pricing.py (leg pricing) and fares/international_pkp.py.

A grid of synthetic legs (carrier name x mode x MOTIS mode x line x stop pair x duration x track km)
is priced by the Python oracle; the TypeScript tests rebuild the same legs from the axes stored in the
output and must reproduce the full PricedLeg (amount, currency, type, notes, breakdown, carrier) or the
detection predicates. Distances are stored (computed by Python) so that last-digit libm differences in
haversine cannot move a leg across a price band.

The unofficial FlixBus API is patched to "unavailable": the app only ever uses the fallback.

Output: core/golden/pricing.json
Regenerate:  python tools/golden/generate_pricing.py
"""

from datetime import UTC, datetime, timedelta
from unittest import mock

from golden_common import OUT_DIR, canonical, dump, fnv1a64, outcome

from fares import _flixbus_api
from fares.international_pkp import estimate_pkp_offer, spi_range, spi_range_for_segment
from fares.model import Carrier, DiscountProfile, Segment
from routing import pricing as pr
from routing.model import Leg, LegMode
from routing.motis_client import haversine_km

STOPS = {
    "lublin_gl": ("Lublin Główny", 51.2318, 22.5719),
    "lublin_pl": ("Lublin Plac Litewski", 51.2487, 22.5583),
    "waw_c": ("Warszawa Centralna", 52.2288, 21.0033),
    "waw_wsch": ("Warszawa Wschodnia", 52.2519, 21.0522),
    "waw_pludy": ("Warszawa Płudy", 52.2754, 20.9633),
    "waw_lotnisko": ("Warszawa Lotnisko Chopina", 52.1703, 20.9611),
    "pruszkow": ("Pruszków", 52.1666, 20.8073),
    "krk_gl": ("Kraków Główny", 50.0674, 19.9475),
    "krk_lotnisko": ("Kraków Lotnisko", 50.0777, 19.7848),
    "krk_plaszow": ("Kraków Płaszów", 50.0377, 19.9628),
    "poznan": ("Poznań Główny", 52.4018, 16.9109),
    "wroclaw": ("Wrocław Główny", 51.0989, 17.0362),
    "gdynia": ("Gdynia Główna", 54.52, 18.53),
    "sopot": ("Sopot", 54.449, 18.569),
    "wejherowo": ("Wejherowo", 54.607, 18.237),
    "lodz_widzew": ("Łódź Widzew", 51.76, 19.537),
    "lodz_fabr": ("Łódź Fabryczna", 51.7686, 19.4686),
    "zgierz": ("Zgierz", 51.857, 19.407),
    "berlin_hbf": ("Berlin Hbf", 52.5251, 13.3694),
    "ber": ("Flughafen BER", 52.3644, 13.5108),
    "hamburg": ("Hamburg Hbf", 53.553, 10.006),
    "munchen": ("München Hbf", 48.1403, 11.56),
    "koln": ("Köln Hbf", 50.943, 6.959),
    "gelsenkirchen": ("Gelsenkirchen Hbf", 51.505, 7.102),
    "dortmund": ("Dortmund Hbf", 51.5178, 7.459),
    "siegen": ("Siegen Hbf", 50.876, 8.022),
    "gorlitz": ("Görlitz", 51.152, 14.983),
    "zgorzelec": ("Zgorzelec", 51.156, 15.007),
    "zasieki": ("Zasieki", 51.5886, 14.7283),
    "forst": ("Forst (Lausitz)", 51.7357, 14.6377),
    "ffo": ("Frankfurt (Oder)", 52.3363, 14.546),
    "slubice": ("Słubice", 52.349, 14.558),
    "szczecin": ("Szczecin Główny", 53.419, 14.553),
    "cottbus": ("Cottbus Hbf", 51.75, 14.332),
}
PAIRS = [
    ("lublin_gl", "lublin_pl"),
    ("lublin_gl", "waw_c"),
    ("waw_c", "waw_wsch"),
    ("waw_pludy", "waw_lotnisko"),
    ("waw_lotnisko", "waw_pludy"),
    ("waw_c", "pruszkow"),
    ("krk_gl", "krk_plaszow"),
    ("krk_gl", "krk_lotnisko"),
    ("krk_gl", "waw_c"),
    ("poznan", "wroclaw"),
    ("gdynia", "sopot"),
    ("gdynia", "wejherowo"),
    ("sopot", "gdynia"),
    ("lodz_widzew", "lodz_fabr"),
    ("lodz_fabr", "zgierz"),
    ("berlin_hbf", "ber"),
    ("ber", "berlin_hbf"),
    ("berlin_hbf", "hamburg"),
    ("hamburg", "hamburg"),
    ("munchen", "munchen"),
    ("koln", "koln"),
    ("gelsenkirchen", "dortmund"),
    ("siegen", "dortmund"),
    ("gorlitz", "zgorzelec"),
    ("zgorzelec", "gorlitz"),
    ("zasieki", "forst"),
    ("forst", "zasieki"),
    ("waw_c", "berlin_hbf"),
    ("berlin_hbf", "waw_c"),
    ("krk_gl", "berlin_hbf"),
    ("lublin_gl", "gelsenkirchen"),
    ("wroclaw", "gorlitz"),
    ("szczecin", "berlin_hbf"),
    ("ffo", "slubice"),
    ("cottbus", "ffo"),
    ("gorlitz", "gorlitz"),
]
# Legs without coordinates (names only / stop-id prefixes only / nothing)
NAMED = [
    ("Lublin Główny", "Lublin Wschodni", None, None, 8.0),
    ("Warszawa Centralna", "Berlin Hbf", None, None, 520.0),
    ("Kraków Główny", "Kraków Lotnisko", None, None, 12.0),
    ("Gdynia Główna", "Sopot", "pl_1", "pl_2", None),
    ("Warszawa Centralna", "Berlin Hbf", "pl_1", "defv_2", 520.0),
    ("Berlin Hbf", "Flughafen BER", "defv_1", "defv_2", 22.0),
    ("Łódź Widzew", "Łódź Fabryczna", None, None, 5.0),
    ("Görlitz", "Zgorzelec", "derv_1", "pl_2", 2.0),
    ("Zgorzelec", "Görlitz", None, None, 2.0),
    ("Zasieki", "Forst (Lausitz)", None, None, 9.0),
    ("Hamburg Hbf", "Hamburg Altona", None, None, 4.0),
    ("München Hbf", "Mvv Pasing", None, None, 8.0),
    ("Köln Hbf", "Köln Messe/Deutz", None, None, 2.0),
    ("Wrocław Główny", "Wrocław Mikołajów", None, None, 3.0),
    ("Warszawa Płudy", "Warszawa Lotnisko Chopina", None, None, 7.0),
    ("Poznań Główny", "Poznań Garbary", None, None, 3.0),
    ("Skądś", "Dokądś", None, None, None),
]

CARRIERS = [
    "",
    "PKP Intercity",
    "DB Fernverkehr AG",
    "Deutsche Bahn",
    "DB",
    "POLREGIO",
    "Polregio Sp. z o.o.",
    "Koleje Dolnośląskie",
    "Koleje Śląskie",
    "Koleje Mazowieckie",
    "KM",
    "WKD",
    "Warszawska Kolej Dojazdowa",
    "SKM Trójmiasto",
    "SKM",
    "SKM w Trójmieście",
    "SKM Warszawa",
    "ŁKA",
    "Łódzka Kolej Aglomeracyjna",
    "Koleje Małopolskie",
    "KMŁ",
    "FlixTrain",
    "FlixBus",
    "RegioJet",
    "BlaBlaBus",
    "ZVON",
    "ZVON Verkehr",
    "trilex",
    "S-Bahn Berlin GmbH",
    "DB Regio AG NRW",
    "DB Regio",
    "BVG",
    "HVV",
    "MVV",
    "Rheinbahn",
    "ZTM Warszawa",
    "MPK Kraków",
    "ZDITM Lublin",
    "Berlin-Warszawa-Express Pendolino",
    "ODEG",
]
MOTIS_MODES = [None, "SUBURBAN", "BUS", "COACH"]
ROUTES = [None, "EIC", "RB66"]
MODES = ["kolej", "autobus"]
DURATIONS = [3, 10, 25, 45, 75, 100, 200]
DEPART = datetime(2026, 10, 20, 8, 0, tzinfo=UTC)


def pair_descriptors() -> list[dict]:
    out = []
    for a, b in PAIRS:
        na, la, loa = STOPS[a]
        nb, lb, lob = STOPS[b]
        km = haversine_km(la, loa, lb, lob)
        out.append(
            {
                "o": na, "d": nb, "olat": la, "olon": loa, "dlat": lb, "dlon": lob,
                "dist": round(km, 9), "along": round(km * 1.2, 9),
                "ostop": None, "dstop": None,
            }
        )  # fmt: skip
    for o, d, os_, ds, dist in NAMED:
        out.append(
            {
                "o": o, "d": d, "olat": None, "olon": None, "dlat": None, "dlon": None,
                "dist": dist, "along": None if dist is None else round(dist * 1.2, 9),
                "ostop": os_, "dstop": ds,
            }
        )  # fmt: skip
    return out


def make_leg(c: dict) -> Leg:
    p = c["pair"]
    extra = {}
    if p["olat"] is not None:
        extra.update(
            origin_lat=p["olat"],
            origin_lon=p["olon"],
            destination_lat=p["dlat"],
            destination_lon=p["dlon"],
        )
    if p["ostop"]:
        extra["origin_stop_id"] = p["ostop"]
    if p["dstop"]:
        extra["destination_stop_id"] = p["dstop"]
    if c["motis"]:
        extra["motis_mode"] = c["motis"]
    if c["route"]:
        extra["route_short_name"] = c["route"]
    if c.get("along"):
        extra["distance_along_track_km"] = p["along"]
        extra["distance_along_track_source"] = "geometria odcinka z MOTIS (legGeometry)"
    mode = LegMode(c["mode"])
    return Leg(
        mode=mode,
        origin_name=p["o"],
        destination_name=p["d"],
        depart=DEPART,
        arrive=DEPART + timedelta(minutes=c.get("duration", 30)),
        carrier_name=c["carrier"],
        distance_km=p["dist"],
        extra=extra,
    )


def detect(leg: Leg) -> dict:
    ends = pr._leg_endpoints(leg)
    frac = pr.german_portion_fraction(leg)
    return {
        "city": pr._city_carrier_for_leg(leg),
        "city_de": pr._city_carrier_for_leg(leg, pr._DE_CITY_RAIL_CARRIERS),
        "city_waw": pr._city_carrier_for_leg(leg, (Carrier.ZTM_WARSZAWA,)),
        "zvon_area": pr._is_in_zvon_gorlitz_area(leg),
        "zvon": pr._is_zvon_europastadt_leg(leg),
        "bvg_zone": pr._bvg_tariff_zone(leg),
        "nrw": pr.is_leg_in_nrw(leg),
        "o_country": pr._leg_endpoint_country(leg, "origin"),
        "d_country": pr._leg_endpoint_country(leg, "destination"),
        "frac": None if frac is None else round(frac, 9),
        "cross": pr.is_cross_border_pl_de(leg),
        "rail": pr.infer_rail_carrier(leg.carrier_name),
        "regional": pr.infer_pl_regional_carrier(leg),
        "local": pr.infer_pl_local_rail_carrier(leg),
        "km_wkd": pr._is_km_or_wkd(leg),
        "kml": pr._is_koleje_malopolskie(leg),
        "kmz": pr._is_koleje_mazowieckie(leg),
        "airport_line": pr.is_warsaw_airport_line(leg),
        "premium": pr.is_pkp_premium_train(leg),
        "kd": pr.is_kd_zgorzelec_gorlitz(leg),
        "graniczny": pr.is_bilet_graniczny_zasieki_forst(leg),
        "suburban": pr.is_suburban_leg(leg),
        "train_line": pr.is_train_like_line(leg),
        "ends": ends is not None,
    }


def priced(leg: Leg, profile: DiscountProfile) -> dict:
    res = outcome(pr.price_leg, leg, profile)
    if "ok" in res:
        pl = res["ok"]
        return {
            "ok": {
                "amount": pl.amount, "currency": pl.currency, "price_type": pl.price_type,
                "notes": pl.notes, "breakdown": pl.breakdown, "carrier": pl.carrier,
            }
        }  # fmt: skip
    return res


def profile_variants() -> list[DiscountProfile]:
    return [
        DiscountProfile(),
        DiscountProfile(age=8, child_with_guardian=True),
        DiscountProfile(age=20, pkp_ulga_kod="student_do_26_lat_doktorant_do_35_lat", ztm_warszawa_ulgowy=True,
                        mpk_krakow_ulgowy=True, ztm_lublin_ulgowy=True, bvg_berlin_ulgowy=True),
        DiscountProfile(age=70, bahncard="50"),
        DiscountProfile(age=16, bahncard="25", obywatelstwo="UE", vrr_dziecko=True, hvv_dziecko=True),
    ]  # fmt: skip


def main() -> None:
    pairs = pair_descriptors()
    profiles = profile_variants()
    flix_off = mock.patch.object(
        _flixbus_api,
        "find_city_id",
        side_effect=_flixbus_api.FlixbusApiError("nie pobierane w tej aplikacji: brak serwera"),
    )
    grids = []

    def add(name, axes, cases):
        grids.append(
            {"name": name, "axes": axes, "hashes": [fnv1a64(canonical(c))[:12] for c in cases]}
        )

    with flix_off:
        # detection: carrier x mode x motis x route x pair
        det_axes = [
            ["carrier", CARRIERS], ["mode", MODES], ["motis", MOTIS_MODES], ["route", ROUTES], ["pair", pairs],
        ]  # fmt: skip
        det_cases = []
        for cr in CARRIERS:
            for md in MODES:
                for mm in MOTIS_MODES:
                    for rt in ROUTES:
                        for p in pairs:
                            det_cases.append(detect(make_leg(
                                {"carrier": cr, "mode": md, "motis": mm, "route": rt, "pair": p})))  # fmt: skip
        add("detect", det_axes, det_cases)

        # pricing (default profile): + duration x along-track
        price_axes = det_axes + [["along", [False, True]]]
        price_cases = []
        for cr in CARRIERS:
            for md in MODES:
                for mm in MOTIS_MODES:
                    for rt in ROUTES:
                        for p in pairs:
                            for al in (False, True):
                                leg = make_leg({"carrier": cr, "mode": md, "motis": mm, "route": rt,
                                                "pair": p, "duration": 25, "along": al})  # fmt: skip
                                price_cases.append(priced(leg, profiles[0]))
        add("price", price_axes, price_cases)

        # ride duration matters for the time-ticket city tariffs
        dur_carriers = [
            "ZTM Warszawa",
            "MPK Kraków",
            "ZDITM Lublin",
            "BVG",
            "HVV",
            "MVV",
            "Rheinbahn",
            "KM",
            "SKM Warszawa",
            "ŁKA",
            "",
        ]
        dur_axes = [
            ["carrier", dur_carriers],
            ["mode", MODES],
            ["pair", pairs],
            ["duration", DURATIONS],
        ]
        dur_cases = []
        for cr in dur_carriers:
            for md in MODES:
                for p in pairs:
                    for du in DURATIONS:
                        leg = make_leg({"carrier": cr, "mode": md, "motis": None, "route": None, "pair": p,
                                        "duration": du, "along": False})  # fmt: skip
                        dur_cases.append(priced(leg, profiles[0]))
        add("durations", dur_axes, dur_cases)

        # profiles: a subset of carriers
        sub_carriers = ["PKP Intercity", "DB Fernverkehr AG", "POLREGIO", "Koleje Mazowieckie", "SKM",
                        "Koleje Małopolskie", "ŁKA", "S-Bahn Berlin GmbH", "HVV", "", "BVG", "ZVON"]  # fmt: skip
        prof_axes = [
            ["carrier", sub_carriers],
            ["mode", MODES],
            ["pair", pairs],
            ["profile", list(range(len(profiles)))],
        ]
        prof_cases = []
        for cr in sub_carriers:
            for md in MODES:
                for p in pairs:
                    for pi in range(len(profiles)):
                        leg = make_leg({"carrier": cr, "mode": md, "motis": None, "route": None, "pair": p,
                                        "duration": 25, "along": False})  # fmt: skip
                        prof_cases.append(priced(leg, profiles[pi]))
        add("profiles", prof_axes, prof_cases)

    # readable: a few fully stored priced legs (diffs are legible)
    readable = []
    for cr, md, mm, rt, pi in [
        ("PKP Intercity", "kolej", None, "EIP", 0),
        ("PKP Intercity", "kolej", None, None, 0),
        ("Berlin-Warszawa-Express Pendolino", "kolej", None, None, 0),
        ("DB Fernverkehr AG", "kolej", None, None, 3),
        ("Koleje Mazowieckie", "kolej", None, None, 0),
        ("SKM Warszawa", "autobus", "SUBURBAN", None, 0),
        ("S-Bahn Berlin GmbH", "autobus", "SUBURBAN", None, 0),
        ("ODEG", "kolej", None, None, 0),
        ("Rheinbahn", "autobus", None, None, 0),
    ]:
        for pi_, p in enumerate(pairs):
            leg = make_leg(
                {
                    "carrier": cr,
                    "mode": md,
                    "motis": mm,
                    "route": rt,
                    "pair": p,
                    "duration": 25,
                    "along": False,
                }
            )
            with flix_off:
                res = priced(leg, profiles[pi])
            readable.append(
                {
                    "carrier": cr,
                    "mode": md,
                    "motis": mm,
                    "route": rt,
                    "pair": pi_,
                    "profile": pi,
                    "expect": res,
                }
            )

    # international_pkp
    ipkp_names = [
        ("Warszawa Centralna", "Berlin Hbf"), ("Berlin Hbf", "Kraków Główny"), ("Poznań Główny", "Berlin Ostbahnhof"),
        ("Gdańsk Główny", "Berlin Hbf"), ("Berlin", "Berlin"), ("Warszawa", "Kraków"), ("Wrocław", "Berlin Hbf"),
        ("Szczecin Główny", "Berlin Hbf"), ("Rzepin", "Berlin Hbf"), ("Świebodzin", "Berlin-Spandau"),
        ("Konin", "Berlin Hbf"), ("Kutno", "Berlin Hbf"), ("Łódź Fabryczna", "Berlin Hbf"), ("", ""),
        ("Berlin Hbf", "Zbąszynek"), ("Berlin Hbf", "Poznań Główny"), ("Lublin Główny", "Berlin Hbf"),
    ]  # fmt: skip
    ages = [None, 0, 5, 6, 14, 15, 26, 27, 60]
    ipkp = []
    for o, d in ipkp_names:
        for age in ages:
            seg = Segment(Carrier.INTERNATIONAL_PL_DE, o, d, discounts=DiscountProfile(age=age))
            est = estimate_pkp_offer(seg)
            ipkp.append(
                {
                    "o": o, "d": d, "age": age,
                    "offer": None if est is None else {"amount": est.amount, "currency": est.currency,
                                                       "price_type": est.price_type, "breakdown": est.breakdown,
                                                       "notes": est.notes},
                    "spi_seg": spi_range_for_segment(seg),
                    "spi_k1": spi_range(o, d, "klasa_1"),
                }
            )  # fmt: skip
    wrong = outcome(estimate_pkp_offer, Segment(Carrier.DB, "a", "b"))

    data = {
        "grids": grids,
        "pairs": pairs,
        "carriers": CARRIERS,
        "readable": readable,
        "international_pkp": ipkp,
        "international_pkp_wrong_carrier": wrong,
        "walk": priced(
            make_leg(
                {
                    "carrier": "pieszo",
                    "mode": "pieszo",
                    "motis": None,
                    "route": None,
                    "pair": pairs[0],
                }
            ),
            profiles[0],
        ),
        "constants": {
            "local_bus_max_km": pr.LOCAL_BUS_MAX_KM,
            "city_areas": {c.value: list(a) for c, a in pr.CITY_TARIFF_AREAS.items()},
        },
    }
    dump(OUT_DIR / "pricing.json", data)


if __name__ == "__main__":
    main()
