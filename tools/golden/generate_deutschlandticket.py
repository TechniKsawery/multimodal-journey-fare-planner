"""Golden vectors for the Deutschlandticket / BahnCard 100 rule (routing/pricing.py::_deutschlandticket_leg).

A grid of synthetic MOTIS legs (MOTIS mode x agency x line x stop pair) is priced under four profiles
(no ticket, Deutschlandticket, BahnCard 100, BahnCard 50). The TypeScript tests rebuild the same
itineraries from the stored axes and must reproduce the summary of every result (fingerprint of the
whole grid + the full summary of a readable named subset).

Output: core/golden/deutschlandticket.json
Regenerate:  python tools/golden/generate_deutschlandticket.py
"""

from unittest import mock

from golden_common import OUT_DIR, canonical, dump, fnv1a64, product_cases

from fares import _flixbus_api
from fares.model import DiscountProfile
from routing import motis_client
from routing.pricing import price_leg

STOPS = {
    "hamm": ["Hamm(Westf)Hbf", 51.6781, 7.8083],
    "gelsen": ["Gelsenkirchen Hbf", 51.5049, 7.1022],
    "berlin": ["Berlin Hbf", 52.5251, 13.3694],
    "berlin_ost": ["Berlin Ostbahnhof", 52.5107, 13.4346],
    "hamburg": ["Hamburg Hbf", 53.553, 10.0063],
    "dresden": ["Dresden Hbf", 51.0403, 13.7324],
    "goerlitz": ["Görlitz", 51.1493, 14.9855],
    "frankfurt_oder": ["Frankfurt (Oder)", 52.3359, 14.5459],
    "slubice": ["Słubice", 52.3498, 14.5617],
    "wroclaw": ["Wrocław Główny", 51.0989, 17.0362],
    "warszawa": ["Warszawa Centralna", 52.2288, 21.0033],
}
PAIRS = [
    ["hamm", "gelsen"],
    ["berlin", "hamburg"],
    ["berlin", "berlin_ost"],
    ["goerlitz", "dresden"],
    ["frankfurt_oder", "slubice"],
    ["wroclaw", "goerlitz"],
    ["wroclaw", "warszawa"],
]
MODES = [
    "RAIL",
    "REGIONAL_RAIL",
    "REGIONAL_FAST_RAIL",
    "SUBURBAN",
    "BUS",
    "TRAM",
    "SUBWAY",
    "HIGHSPEED_RAIL",
    "LONG_DISTANCE",
    "NIGHT_RAIL",
    "COACH",
]
AGENCIES = [
    "DB Regio AG NRW",
    "ODEG",
    "DB Fernverkehr AG",
    "FlixBus",
    "FlixTrain",
    "S-Bahn Berlin GmbH",
]
ROUTES = ["RE 3", "RB 26", "IRE 1", "ICE 845", "IC 2", "S5", ""]
PROFILES = [
    {},
    {"deutschlandticket": True},
    {"bahncard": "100"},
    {"bahncard": "50"},
]

NAMED = [
    {
        "profile": 1,
        "mode": "REGIONAL_FAST_RAIL",
        "agency": "DB Regio AG NRW",
        "route": "RE 3",
        "pair": 0,
    },
    {
        "profile": 1,
        "mode": "REGIONAL_FAST_RAIL",
        "agency": "DB Regio AG NRW",
        "route": "IRE 1",
        "pair": 0,
    },
    {
        "profile": 2,
        "mode": "REGIONAL_FAST_RAIL",
        "agency": "DB Regio AG NRW",
        "route": "IRE 1",
        "pair": 0,
    },
    {"profile": 1, "mode": "SUBURBAN", "agency": "S-Bahn Berlin GmbH", "route": "S5", "pair": 2},
    {
        "profile": 1,
        "mode": "HIGHSPEED_RAIL",
        "agency": "DB Fernverkehr AG",
        "route": "ICE 845",
        "pair": 1,
    },
    {
        "profile": 2,
        "mode": "HIGHSPEED_RAIL",
        "agency": "DB Fernverkehr AG",
        "route": "ICE 845",
        "pair": 1,
    },
    {
        "profile": 3,
        "mode": "HIGHSPEED_RAIL",
        "agency": "DB Fernverkehr AG",
        "route": "ICE 845",
        "pair": 1,
    },
    {"profile": 1, "mode": "COACH", "agency": "FlixBus", "route": "", "pair": 1},
    {"profile": 1, "mode": "REGIONAL_RAIL", "agency": "ODEG", "route": "RB 26", "pair": 4},
    {"profile": 1, "mode": "RAIL", "agency": "ODEG", "route": "RB 26", "pair": 1},
    {
        "profile": 0,
        "mode": "REGIONAL_FAST_RAIL",
        "agency": "DB Regio AG NRW",
        "route": "RE 3",
        "pair": 0,
    },
]


def itinerary(mode, agency, route, pair):
    a, b = (STOPS[k] for k in pair)
    return {
        "legs": [
            {
                "mode": mode,
                "agencyName": agency,
                "routeShortName": route,
                "from": {"name": a[0], "lat": a[1], "lon": a[2]},
                "to": {"name": b[0], "lat": b[1], "lon": b[2]},
                "startTime": "2026-12-01T06:00:00Z",
                "endTime": "2026-12-01T07:00:00Z",
            }
        ]
    }


def summary(case: dict) -> list:
    profile = DiscountProfile(**PROFILES[case["profile"]])
    leg = motis_client.itinerary_to_legs(
        itinerary(case["mode"], case["agency"], case["route"], case["pair"])
    )[0]
    priced = price_leg(leg, profile)
    return [
        round(priced.amount, 2),
        priced.currency,
        priced.price_type,
        priced.price_verified,
        priced.carrier.value if priced.carrier else None,
        bool(priced.breakdown.get("deutschlandticket")),
        priced.breakdown.get("podstawa"),
    ]


def main() -> None:
    results = []
    flix_off = mock.patch.object(  # the app only ever uses the FlixBus fallback, never the live API
        _flixbus_api,
        "find_city_id",
        side_effect=_flixbus_api.FlixbusApiError("nie pobierane w tej aplikacji: brak serwera"),
    )
    with flix_off:
        for combo in product_cases(
            {
                "profile": range(len(PROFILES)),
                "mode": MODES,
                "agency": AGENCIES,
                "route": ROUTES,
                "pair": range(len(PAIRS)),
            }
        ):
            results.append(summary({**combo, "pair": PAIRS[combo["pair"]]}))
        named = [{"case": n, "result": summary({**n, "pair": PAIRS[n["pair"]]})} for n in NAMED]
    dump(
        OUT_DIR / "deutschlandticket.json",
        {
            "stops": STOPS,
            "pairs": PAIRS,
            "modes": MODES,
            "agencies": AGENCIES,
            "routes": ROUTES,
            "profiles": PROFILES,
            "count": len(results),
            "hash": fnv1a64(canonical(results)),
            "covered_count": sum(1 for r in results if r[5]),
            "named": named,
        },
    )


if __name__ == "__main__":
    main()
