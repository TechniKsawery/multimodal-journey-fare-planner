"""Golden vectors for the KD "Dresden Promotion" bundle (routing/pricing.py::apply_kd_dresden_promotion).

Scenarios = origin station x itinerary shape (KD + Die Länderbahn legs, a bus replacement, a direct Zgorzelec
train, legs before and after the bundle, other operators) x passenger age. Each scenario lists its legs as
[carrier, MOTIS mode, from stop, to stop]; the TypeScript tests rebuild the same legs, price them and apply
the bundle, and must reproduce the full per-leg summary (including the notes) of every scenario.

Output: core/golden/kd_dresden.json
Regenerate:  python tools/golden/generate_kd_dresden.py
"""

from datetime import datetime, timedelta
from unittest import mock

from golden_common import OUT_DIR, canonical, dump, fnv1a64

from fares import _flixbus_api
from fares.model import DiscountProfile
from routing import motis_client
from routing.pricing import apply_kd_dresden_promotion, price_leg

STOPS = {
    "Wrocław Główny": [51.0989, 17.0362],
    "Jelenia Góra": [50.9016, 15.7352],
    "Legnica": [51.2051, 16.1559],
    "Bolesławiec": [51.2574, 15.5641],
    "Zgorzelec": [51.1513, 15.0087],
    "Zgorzelec Miasto": [51.1553, 15.0028],
    "Legnica Piekary": [51.2, 16.2],
    "Wrocław Nadodrze": [51.1214, 17.0301],
    "Görlitz": [51.1493, 14.9855],
    "Dresden Hbf": [51.0403, 13.7324],
    "Dresden Neustadt": [51.0654, 13.7413],
    "Warszawa Centralna": [52.2288, 21.0033],
}
ORIGINS = [
    "Wrocław Główny",
    "Jelenia Góra",
    "Legnica",
    "Bolesławiec",
    "Zgorzelec",
    "Zgorzelec Miasto",
    "Legnica Piekary",
    "Wrocław Nadodrze",
]
KD = "Koleje Dolnośląskie S.A."
DLB = "Die Länderbahn GmbH DLB"
TRILEX = "trilex"
AGES = [None, 5, 6, 15, 16, 30]

# shape name -> legs as [carrier, motis_mode, from ("O" = the origin), to]
SHAPES = {
    "single_kd": [[KD, "REGIONAL_RAIL", "O", "Dresden Hbf"]],
    "kd_plus_dlb": [
        [KD, "REGIONAL_RAIL", "O", "Görlitz"],
        [DLB, "REGIONAL_RAIL", "Görlitz", "Dresden Hbf"],
    ],
    "kd_kd_dlb": [
        [KD, "REGIONAL_RAIL", "O", "Zgorzelec"],
        [KD, "REGIONAL_RAIL", "Zgorzelec", "Görlitz"],
        [TRILEX, "REGIONAL_RAIL", "Görlitz", "Dresden Hbf"],
    ],
    "bus_replacement": [
        [KD, "BUS", "O", "Görlitz"],
        [DLB, "REGIONAL_RAIL", "Görlitz", "Dresden Hbf"],
    ],
    "other_operator": [
        [KD, "REGIONAL_RAIL", "O", "Görlitz"],
        ["DB Regio AG", "REGIONAL_RAIL", "Görlitz", "Dresden Hbf"],
    ],
    "not_reaching_dresden": [[KD, "REGIONAL_RAIL", "O", "Görlitz"]],
    "ends_at_neustadt": [
        [KD, "REGIONAL_RAIL", "O", "Görlitz"],
        [DLB, "REGIONAL_RAIL", "Görlitz", "Dresden Neustadt"],
    ],
    "with_legs_around": [
        ["PKP Intercity", "HIGHSPEED_RAIL", "Warszawa Centralna", "O"],
        [KD, "REGIONAL_RAIL", "O", "Görlitz"],
        [DLB, "REGIONAL_RAIL", "Görlitz", "Dresden Hbf"],
        ["DB Regio AG", "SUBURBAN", "Dresden Hbf", "Dresden Neustadt"],
    ],
}
NAMED = [
    ["Wrocław Główny", "kd_plus_dlb", None],
    ["Wrocław Główny", "kd_plus_dlb", 10],
    ["Zgorzelec", "single_kd", None],
    ["Zgorzelec", "kd_kd_dlb", 30],
    ["Legnica", "bus_replacement", None],
    ["Legnica Piekary", "kd_plus_dlb", None],
    ["Jelenia Góra", "with_legs_around", 16],
    ["Bolesławiec", "kd_plus_dlb", 5],
]


def scenario_legs(origin: str, shape: str):
    out = []
    t0 = datetime(2026, 12, 1, 6, 0)
    for n, (carrier, mode, a, b) in enumerate(SHAPES[shape]):
        a = origin if a == "O" else a
        b = origin if b == "O" else b
        out.append([carrier, mode, a, b, (t0 + timedelta(hours=n)).isoformat()])
    return out


def run(origin: str, shape: str, age) -> list:
    legs = []
    for carrier, mode, a, b, start in scenario_legs(origin, shape):
        start_dt = datetime.fromisoformat(start)
        end_dt = start_dt + timedelta(minutes=50)
        raw = {
            "mode": mode,
            "agencyName": carrier,
            "routeShortName": "RE 2",
            "from": {"name": a, "lat": STOPS[a][0], "lon": STOPS[a][1]},
            "to": {"name": b, "lat": STOPS[b][0], "lon": STOPS[b][1]},
            "startTime": start_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endTime": end_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        legs.append(motis_client.itinerary_to_legs({"legs": [raw]})[0])
    profile = DiscountProfile(age=age)
    priced = [price_leg(leg, profile) for leg in legs]
    after = apply_kd_dresden_promotion(legs, priced, profile)
    return [
        [
            round(p.amount, 2),
            p.currency,
            p.price_type,
            p.price_verified,
            bool(p.breakdown.get("kd_dresden_promotion")),
            p.breakdown.get("podstawa"),
            p.notes,
        ]
        for p in after
    ]


def main() -> None:
    flix_off = mock.patch.object(
        _flixbus_api,
        "find_city_id",
        side_effect=_flixbus_api.FlixbusApiError("nie pobierane w tej aplikacji: brak serwera"),
    )
    with flix_off:
        grid = [(o, s, a) for o in ORIGINS for s in SHAPES for a in AGES]
        results = [run(*c) for c in grid]
        named = [{"case": n, "result": run(*n)} for n in NAMED]
    dump(
        OUT_DIR / "kd_dresden.json",
        {
            "stops": STOPS,
            "origins": ORIGINS,
            "ages": AGES,
            "shapes": SHAPES,
            "shape_order": list(SHAPES),
            "count": len(results),
            "bundled": sum(1 for r in results if any(x[4] for x in r)),
            "hash": fnv1a64(canonical(results)),
            "named": named,
        },
    )


if __name__ == "__main__":
    main()
