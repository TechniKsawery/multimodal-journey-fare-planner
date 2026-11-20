"""Golden vectors for the pure half of routing/motis_client.py: polyline decoding, haversine, track
distance, itinerary -> legs and itinerary picking. Inputs are the synthetic MOTIS fixture plus
generated itineraries (no network). Floats are compared by the TypeScript tests with a tolerance
(libm differences between CPython and V8 are possible in the last digits).

Output: core/golden/motis.json
Regenerate:  python tools/golden/generate_motis.py
"""

import copy
import json
from datetime import UTC

from golden_common import OUT_DIR, ROOT, dump, outcome

from routing import motis_client as mc

FIXTURE = json.loads(
    (ROOT / "tests" / "fixtures" / "motis_kd_wroclaw_klodzko.json").read_text("utf-8")
)


def encode(points, precision=6):
    factor = 10**precision
    out, last_lat, last_lon = [], 0, 0
    for lat, lon in points:
        ilat, ilon = round(lat * factor), round(lon * factor)
        for delta in (ilat - last_lat, ilon - last_lon):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        last_lat, last_lon = ilat, ilon
    return "".join(out)


def leg_dict(leg):
    return {
        "mode": leg.mode.value,
        "origin_name": leg.origin_name,
        "destination_name": leg.destination_name,
        "depart_ms": int(leg.depart.astimezone(UTC).timestamp() * 1000),
        "arrive_ms": int(leg.arrive.astimezone(UTC).timestamp() * 1000),
        "carrier_name": leg.carrier_name,
        "distance_km": leg.distance_km,
        "requires_walk": leg.requires_walk,
        "extra": leg.extra,
    }


def place(name, lat, lon, stop=None):
    p = {"name": name, "lat": lat, "lon": lon}
    if stop:
        p["stopId"] = stop
    return p


def raw_leg(mode, a, b, start, end, **kw):
    return {"mode": mode, "from": a, "to": b, "startTime": start, "endTime": end, **kw}


WRO = place("Wrocław Główny", 51.0989, 17.0362, "s_wro")
KLO = place("Kłodzko Główne", 50.4337, 16.6537, "s_klo")
WAW = place("Warszawa Centralna", 52.2288, 21.0033, "s_waw")
BER = place("Berlin Hbf", 52.5251, 13.3694, "s_ber")
ADDR_A = place("ul. Testowa 1", 52.2300, 21.0100)
ADDR_B = place("Am Markt 2", 52.5200, 13.4000)
SHAPE = [(51.0989, 17.0362), (51.0, 17.05), (50.9, 17.0), (50.6, 16.85), (50.4337, 16.6537)]


def itineraries():
    out = {}
    out["fixture"] = FIXTURE
    out["fixture_no_geometry"] = copy.deepcopy(FIXTURE)
    del out["fixture_no_geometry"]["legs"][0]["legGeometry"]
    out["fixture_no_stops"] = copy.deepcopy(FIXTURE)
    del out["fixture_no_stops"]["legs"][0]["intermediateStops"]
    bare = copy.deepcopy(FIXTURE)
    del bare["legs"][0]["legGeometry"], bare["legs"][0]["intermediateStops"]
    out["fixture_bare"] = bare
    bad_end = copy.deepcopy(FIXTURE)
    bad_end["legs"][0]["legGeometry"]["points"] = encode([(52.2, 21.0), (52.4, 21.2), (52.5, 21.5)])
    del bad_end["legs"][0]["intermediateStops"]
    out["geometry_wrong_ends"] = bad_end
    stop_no_lat = copy.deepcopy(FIXTURE)
    del stop_no_lat["legs"][0]["legGeometry"]
    del stop_no_lat["legs"][0]["intermediateStops"][1]["lat"]
    out["stop_without_lat"] = stop_no_lat
    two_pts = copy.deepcopy(FIXTURE)
    two_pts["legs"][0]["legGeometry"] = {"points": encode([SHAPE[0], SHAPE[-1]]), "precision": 6}
    del two_pts["legs"][0]["intermediateStops"]
    out["geometry_two_points"] = two_pts
    p7 = copy.deepcopy(FIXTURE)
    p7["legs"][0]["legGeometry"] = {"points": encode(SHAPE, 7), "precision": 7}
    del p7["legs"][0]["intermediateStops"]
    out["geometry_precision_7"] = p7
    nop = copy.deepcopy(p7)
    nop["legs"][0]["legGeometry"] = {"points": encode(SHAPE, 6)}
    out["geometry_no_precision"] = nop

    out["walk_rail_walk"] = {
        "duration": 7200,
        "transfers": 0,
        "legs": [
            raw_leg(
                "WALK", ADDR_A, WAW, "2026-10-20T06:00:00Z", "2026-10-20T06:15:00Z", distance=1200
            ),
            raw_leg(
                "HIGHSPEED_RAIL",
                WAW,
                BER,
                "2026-10-20T06:30:00Z",
                "2026-10-20T10:30:00Z",
                agencyName="PKP Intercity",
                routeShortName="EIP 1",
            ),
            raw_leg("WALK", BER, ADDR_B, "2026-10-20T10:30:00Z", "2026-10-20T10:50:00Z"),
        ],
    }
    out["transfer_with_walk"] = {
        "duration": 9000,
        "transfers": 2,
        "legs": [
            raw_leg(
                "REGIONAL_RAIL",
                WRO,
                KLO,
                "2026-10-20T08:00:00+02:00",
                "2026-10-20T09:30:00+02:00",
                agencyName="Koleje Dolnośląskie",
            ),
            raw_leg(
                "WALK",
                KLO,
                place("Kłodzko Miasto", 50.4400, 16.6600),
                "2026-10-20T09:30:00Z",
                "2026-10-20T09:45:00Z",
                distance=600,
            ),
            raw_leg(
                "BUS",
                place("Kłodzko Miasto", 50.4400, 16.6600),
                WAW,
                "2026-10-20T10:00:00Z",
                "2026-10-20T14:00:00Z",
                routeShortName="N1",
            ),
            raw_leg(
                "TRAM",
                WAW,
                BER,
                "2026-10-20T14:05:00Z",
                "2026-10-20T14:35:00Z",
                agencyName="",
                routeShortName="12",
            ),
        ],
    }
    out["modes"] = {
        "duration": 100,
        "legs": [
            raw_leg(
                m, WRO, KLO, "2026-10-20T08:00:00Z", "2026-10-20T09:00:00Z", agencyName=f"A-{m}"
            )
            for m in (
                "RAIL",
                "TRAIN",
                "LONG_DISTANCE",
                "NIGHT_RAIL",
                "SUBURBAN",
                "SUBWAY",
                "TRAM",
                "BUS",
                "COACH",
                "FERRY",
                "AIRPLANE",
                "OTHER",
                "REGIONAL_FAST_RAIL",
            )
        ],
    }
    out["only_walk"] = {
        "duration": 600,
        "legs": [
            raw_leg(
                "WALK", ADDR_A, WAW, "2026-10-20T06:00:00Z", "2026-10-20T06:10:00Z", distance=500
            )
        ],
    }
    out["no_carrier"] = {
        "duration": 100,
        "legs": [raw_leg("BUS", WRO, KLO, "2026-10-20T08:00:00Z", "2026-10-20T09:00:00Z")],
    }
    return out


def main() -> None:
    its = itineraries()
    poly_sets = {
        "pl": [(51.0989, 17.0362), (50.7807, 17.0669), (50.4337, 16.6537)],
        "world": [
            (-33.865143, 151.2099),
            (40.7128, -74.006),
            (0.0, 0.0),
            (-89.999999, -179.999999),
            (89.999999, 179.999999),
        ],
        "single": [(0.0, 0.0)],
        "empty": [],
    }
    polylines = []
    for name, pts in poly_sets.items():
        for prec in (5, 6, 7):
            enc = encode(pts, prec)
            polylines.append(
                {
                    "name": name,
                    "precision": prec,
                    "encoded": enc,
                    "decoded": mc.decode_polyline(enc, prec),
                }
            )
    pairs = [
        (51.0989, 17.0362, 50.4337, 16.6537),
        (0, 0, 0, 0),
        (0, 0, 0, 180),
        (-90, 0, 90, 0),
        (52.2297, 21.0122, 52.2297, 21.0122),
        (51.2465, 22.5684, 51.5, 7.0),
        (-33.8688, 151.2093, 40.7128, -74.006),
    ]
    data = {
        "polylines": polylines,
        "haversine": [{"in": list(p), "km": mc.haversine_km(*p)} for p in pairs],
        "track": {
            name: _track(it)
            for name, it in its.items()
            if name.startswith(("fixture", "geometry", "stop"))
        },
        "itineraries": {name: it for name, it in its.items()},
        "legs": {
            name: outcome(lambda it=it: [leg_dict(l) for l in mc.itinerary_to_legs(it)])
            for name, it in its.items()
        },
        "labels": {"geometry": mc.TRACK_KM_GEOMETRY, "stops": mc.TRACK_KM_STOPS},
        "picks": _picks(its),
        "areas": [
            {"in": m, "out": mc._areas(m)}
            for m in (
                {},
                {"areas": []},
                {
                    "areas": [
                        {"name": "Lubelskie", "adminLevel": 4},
                        {"name": "", "adminLevel": 2},
                        {"name": "X"},
                        {"name": "PL", "adminLevel": 0},
                    ]
                },
            )
        ],
    }
    dump(OUT_DIR / "motis.json", _quantize(data))


def _quantize(obj):
    """Floats rounded to 7 decimals: CPython >= 3.12 sums floats with compensation, 3.11 does not,
    which differs in the last digits (the TypeScript tests compare with a tolerance anyway)."""
    if isinstance(obj, float):
        return round(obj, 7)
    if isinstance(obj, dict):
        return {k: _quantize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_quantize(v) for v in obj]
    return obj


def _track(raw):
    first = next((l for l in raw["legs"] if l["mode"] != "WALK"), None)
    r = mc.track_distance_km(first)
    return None if r is None else list(r)


def _picks(its):
    payload = {
        "itineraries": [
            {"duration": 5000, "transfers": 2, "id": "a"},
            {"duration": 4000, "transfers": 2, "id": "b"},
            {"duration": 6000, "transfers": 0, "id": "c"},
            {"duration": 4000, "transfers": 0, "id": "d"},
            {"duration": 4000, "id": "e"},
        ],
        "direct": [{"duration": 3000, "transfers": 5, "id": "w"}],
    }
    no_direct = {"itineraries": payload["itineraries"][:3]}
    return {
        "payload": payload,
        "fastest": mc.fastest_itinerary(payload)["id"],
        "fewest": mc.fewest_transfers_itinerary(payload)["id"],
        "fastest_nodirect": mc.fastest_itinerary(no_direct)["id"],
        "fewest_nodirect": mc.fewest_transfers_itinerary(no_direct)["id"],
        "all_ids": [i["id"] for i in mc._all_itineraries(payload)],
    }


if __name__ == "__main__":
    main()
