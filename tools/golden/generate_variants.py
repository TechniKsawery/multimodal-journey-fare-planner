"""Golden vectors for the rail variants and the search (routing/variants.py, routing/search_service.py).

The routing service is replaced by a synthetic "world": a function (from, to, time) -> MOTIS payload. The generator
RECORDS every request the oracle makes (key = from|to|time|maxTransfers|numItineraries) together with the payload, so
the TypeScript tests replay exactly those payloads through a fake client and must (a) make the same requests, with the
same strings (including the Warsaw-local time with offset and the shifted "onward" time), and (b) produce the same
variants, skipped variants, other-day hints and recommendations.

Flight hubs are not exercised (not ported). Floats are rounded to 2 decimals in the summaries (CPython >= 3.12
compensates float sum(), 3.11 does not).

Output: core/golden/variants.json
Regenerate:  python tools/golden/generate_variants.py
"""

from datetime import UTC, datetime, timedelta
from unittest import mock

from golden_common import OUT_DIR, dump

from fares import _flixbus_api
from fares.model import DiscountProfile
from i18n import Joined, Msg
from routing import motis_client, variants
from routing.model import Itinerary, OtherDayVariant
from routing.motis_client import MotisError, StopRef
from routing.search_service import search
from routing.variants import AlternativeStop, RouteRequest, generate_variants

PLACES = {
    "Lublin Główny": (51.2314, 22.5692),
    "Warszawa Centralna": (52.2288, 21.0033),
    "Poznań Główny": (52.4019, 16.9125),
    "Wrocław Główny": (51.0989, 17.0362),
    "Berlin Hbf": (52.5251, 13.3694),
    "Hannover Hbf": (52.3766, 9.741),
    "Hamm(Westf)Hbf": (51.6781, 7.8083),
    "Dortmund Hbf": (51.5172, 7.4595),
    "Gelsenkirchen Hbf": (51.5049, 7.1022),
    "Essen Hbf": (51.4515, 7.0131),
    "Kraków Główny": (50.0678, 19.9475),
    "Gorlice": (49.6568, 21.1597),
    "Frankfurt (Oder)": (52.3359, 14.5459),
}
STOP_IDS = {  # stop ids as a client would hold them (not names)
    "pl_lublin": "Lublin Główny",
    "pl_warszawa": "Warszawa Centralna",
    "defv_gels": "Gelsenkirchen Hbf",
    "defv_berlin": "Berlin Hbf",
    "pl_krakow": "Kraków Główny",
}
MIDS = [
    "Warszawa Centralna",
    "Berlin Hbf",
    "Hannover Hbf",
    "Hamm(Westf)Hbf",
    "Frankfurt (Oder)",
    "Dortmund Hbf",
]
COUNTRY_PL = {
    "Lublin Główny",
    "Warszawa Centralna",
    "Poznań Główny",
    "Wrocław Główny",
    "Kraków Główny",
    "Gorlice",
}


def place_info(place: str) -> tuple[str, float, float]:
    if place.startswith("id:"):
        name = place[3:]
        return (name, *PLACES[name])
    if place in STOP_IDS:
        name = STOP_IDS[place]
        return (name, *PLACES[name])
    lat, lon = (float(x) for x in place.split(","))
    return (f"Punkt {place}", lat, lon)


def is_coordinate(place: str) -> bool:
    return not place.startswith("id:") and place not in STOP_IDS


def stop(name: str, lat: float, lon: float, t: datetime, key: str) -> dict:
    return {
        "name": name,
        "lat": lat,
        "lon": lon,
        "stopId": f"{key}:{name}",
    }


def z(t: datetime) -> str:
    return t.astimezone(UTC).isoformat().replace("+00:00", "Z")


def carrier_for(a: str, b: str) -> tuple[str, str, str]:
    pl_a, pl_b = a in COUNTRY_PL, b in COUNTRY_PL
    if pl_a and pl_b:
        return "PKP Intercity", "IC 5100", "LONG_DISTANCE"
    if pl_a != pl_b:
        return "PKP Intercity", "EC 45", "LONG_DISTANCE"
    if {a, b} <= {"Hamm(Westf)Hbf", "Dortmund Hbf", "Gelsenkirchen Hbf", "Essen Hbf"}:
        return "DB Regio AG NRW", "RE 3", "REGIONAL_FAST_RAIL"
    return "DB Fernverkehr AG", "ICE 845", "HIGHSPEED_RAIL"


def build_itinerary(
    start: datetime,
    hops: list[tuple[str, int]],
    gaps: list[int],
    walks: list[bool],
    ends: tuple,
    key: str,
):
    """hops = [(place_name, minutes_to_next)] chain; gaps[i] = wait before leg i+1 (minutes)."""
    legs = []
    t = start
    names = [h[0] for h in hops]
    origin_coord, dest_coord = ends
    if origin_coord is not None:
        legs.append(
            {
                "mode": "WALK",
                "from": {"name": origin_coord[0], "lat": origin_coord[1], "lon": origin_coord[2]},
                "to": stop(names[0], *PLACES[names[0]], t, key),
                "startTime": z(t - timedelta(minutes=8)),
                "endTime": z(t),
                "distance": 600,
            }
        )
    for i in range(len(names) - 1):
        agency, route, mode = carrier_for(names[i], names[i + 1])
        end = t + timedelta(minutes=hops[i][1])
        legs.append(
            {
                "mode": mode,
                "agencyName": agency,
                "routeShortName": route,
                "from": stop(names[i], *PLACES[names[i]], t, key),
                "to": stop(names[i + 1], *PLACES[names[i + 1]], end, key),
                "startTime": z(t),
                "endTime": z(end),
            }
        )
        t = end
        if i < len(names) - 2:
            if walks[i]:
                legs.append(
                    {
                        "mode": "WALK",
                        "from": stop(names[i + 1], *PLACES[names[i + 1]], t, key),
                        "to": stop(names[i + 1], *PLACES[names[i + 1]], t, key),
                        "startTime": z(t),
                        "endTime": z(t + timedelta(minutes=4)),
                        "distance": 200,
                    }
                )
            t = t + timedelta(minutes=gaps[i])
    if dest_coord is not None:
        legs.append(
            {
                "mode": "WALK",
                "from": stop(names[-1], *PLACES[names[-1]], t, key),
                "to": {"name": dest_coord[0], "lat": dest_coord[1], "lon": dest_coord[2]},
                "startTime": z(t),
                "endTime": z(t + timedelta(minutes=9)),
                "distance": 700,
            }
        )
    first = datetime.fromisoformat(legs[0]["startTime"].replace("Z", "+00:00"))
    last = datetime.fromisoformat(legs[-1]["endTime"].replace("Z", "+00:00"))
    n_transit = sum(1 for leg in legs if leg["mode"] != "WALK")
    return {
        "duration": int((last - first).total_seconds()),
        "transfers": max(n_transit - 1, 0),
        "startTime": legs[0]["startTime"],
        "endTime": legs[-1]["endTime"],
        "legs": legs,
    }


def world(style: str, from_place: str, to_place: str, time: str) -> dict:
    """The synthetic routing service. `style` picks the behaviour of the whole world."""
    t0 = datetime.fromisoformat(time.replace("Z", "+00:00"))
    if style == "empty":
        return {"itineraries": []}
    a, la, lo = place_info(from_place)
    b, lb, lob = place_info(to_place)
    ends = (
        (f"Adres {a}", la, lo) if is_coordinate(from_place) else None,
        (f"Adres {b}", lb, lob) if is_coordinate(to_place) else None,
    )
    na = a if a in PLACES else MIDS[0]
    nb = b if b in PLACES else MIDS[-1]
    mid_default = MIDS[(sum(map(ord, na + nb)) % len(MIDS))]
    mid = "Wrocław Główny" if style == "revisit" else mid_default
    if mid in (na, nb):
        mid = "Hannover Hbf" if "Hannover Hbf" not in (na, nb) else "Berlin Hbf"
    key = "w"
    base = t0 + timedelta(minutes=25)
    if style == "otherday":
        base = base + timedelta(days=1, hours=2)
    if style == "otherday_far":
        base = base + timedelta(days=5)
    gap = 3 if style in ("infeasible", "infeasible_all") else 25
    if style == "direct":
        return {
            "itineraries": [
                build_itinerary(base, [(na, 200), (nb, 0)], [], [], ends, key),
                build_itinerary(
                    base + timedelta(minutes=40), [(na, 190), (nb, 0)], [], [], ends, key
                ),
            ]
        }
    if style == "infeasible_all":
        return {
            "itineraries": [
                build_itinerary(base, [(na, 180), (mid, 150), (nb, 0)], [gap], [True], ends, key),
                build_itinerary(
                    base + timedelta(minutes=30),
                    [(na, 120), (mid, 200), (nb, 0)],
                    [1],
                    [False],
                    ends,
                    key,
                ),
            ]
        }
    its = [
        build_itinerary(base, [(na, 180), (mid, 150), (nb, 0)], [gap], [True], ends, key),
        build_itinerary(base + timedelta(minutes=70), [(na, 400), (nb, 0)], [], [], ends, key),
        build_itinerary(
            base + timedelta(minutes=15),
            [(na, 100), (mid, 90), (nb, 0)],
            [gap + 9],
            [False],
            ends,
            key,
        ),
    ]
    if style == "normal":
        its.append(
            build_itinerary(base + timedelta(days=1), [(na, 410), (nb, 0)], [], [], ends, key)
        )
        its.append(
            build_itinerary(base + timedelta(minutes=70), [(na, 400), (nb, 0)], [], [], ends, key)
        )  # duplicate route
    payload = {"itineraries": its}
    if style == "walk":
        payload = {
            "itineraries": [],
            "direct": [
                {
                    "duration": 480,
                    "transfers": 0,
                    "startTime": z(t0),
                    "endTime": z(t0 + timedelta(minutes=8)),
                    "legs": [
                        {
                            "mode": "WALK",
                            "from": {"name": f"Adres {a}", "lat": la, "lon": lo},
                            "to": {"name": f"Adres {b}", "lat": lb, "lon": lob},
                            "startTime": z(t0),
                            "endTime": z(t0 + timedelta(minutes=8)),
                            "distance": 500,
                        }
                    ],
                }
            ],
        }
    return payload


def item_json(it: Itinerary) -> dict:
    return {
        "name": msg_json(it.variant_name),
        "price": round(it.total_price_pln, 2),
        "duration": round(it.total_duration_min, 2),
        "transfers": it.num_transfers,
        "legs": [
            [
                pl.leg.origin_name,
                pl.leg.destination_name,
                pl.leg.depart.isoformat(),
                pl.leg.arrive.isoformat(),
                pl.leg.mode.value,
                round(pl.amount, 2),
                pl.currency,
                pl.price_verified,
                pl.leg.requires_walk,
            ]
            for pl in it.legs
        ],
        "warnings": [
            [w.after_leg_index, w.gap_minutes, w.infeasible] for w in it.transfer_warnings
        ],
        "safe_fallback": it.is_safe_fallback,
    }


def msg_json(m):
    if isinstance(m, Msg):
        return {"key": m.key, "params": {k: msg_json(v) for k, v in m.params.items()}}
    if isinstance(m, Joined):
        return {"joined": [msg_json(x) for x in m.items], "sep": m.sep}
    if isinstance(m, float):
        return round(m, 4)
    return str(m) if isinstance(m, str) else m


def skipped_json(s) -> dict:
    return {"name": msg_json(s.variant_name), "reason": msg_json(s.reason)}


def other_json(o: OtherDayVariant) -> dict:
    return {
        "item": item_json(o.itinerary),
        "date": o.date,
        "requested": o.requested_date,
        "offset": o.days_offset,
    }


POZNAN = StopRef("Poznań Główny", 52.4019, 16.9125)
ESSEN = StopRef("Essen Hbf", 51.4515, 7.0131)
DORTMUND = StopRef("Dortmund Hbf", 51.5172, 7.4595)

STUDENT = {"pkp_ulga_kod": "student_do_26_lat_doktorant_do_35_lat", "age": 21}
CASES = [
    {
        "name": "ids normal",
        "style": "normal",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-12-01",
        "time": "06:00:00",
        "via": [POZNAN],
    },
    {
        "name": "student profile",
        "style": "normal",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-12-01",
        "time": "09:30:00",
        "profile": STUDENT,
        "via": [POZNAN],
    },
    {
        "name": "addresses",
        "style": "normal",
        "o": "51.2465,22.5684",
        "d": "51.5049,7.1022",
        "date": "2026-12-01",
        "time": "06:00:00",
        "via": [POZNAN],
    },
    {
        "name": "alternatives",
        "style": "normal",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-12-02",
        "time": "06:00:00",
        "via": [POZNAN],
        "alt_o": [AlternativeStop("Warszawa", "id:Warszawa Centralna")],
        "alt_d": [AlternativeStop("Essen Hbf", ESSEN), AlternativeStop("Dortmund Hbf", DORTMUND)],
    },
    {
        "name": "all connections on another day",
        "style": "otherday",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-12-01",
        "time": "06:00:00",
        "via": [],
    },
    {
        "name": "another day too far",
        "style": "otherday_far",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-12-01",
        "time": "06:00:00",
        "via": [],
    },
    {
        "name": "no connections",
        "style": "empty",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-12-01",
        "time": "06:00:00",
        "via": [POZNAN],
    },
    {
        "name": "direct itineraries, the via variant works",
        "style": "direct",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-12-01",
        "time": "06:00:00",
        "via": [POZNAN],
    },
    {
        "name": "all transfers infeasible",
        "style": "infeasible_all",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-12-01",
        "time": "06:00:00",
        "via": [POZNAN],
    },
    {
        "name": "some infeasible transfers",
        "style": "infeasible",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-12-01",
        "time": "06:00:00",
        "via": [POZNAN],
    },
    {
        "name": "via revisits a station",
        "style": "revisit",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-12-01",
        "time": "06:00:00",
        "via": [POZNAN],
    },
    {
        "name": "via is a detour",
        "style": "normal",
        "o": "50.0678,19.9475",
        "d": "49.6568,21.1597",
        "date": "2026-12-01",
        "time": "06:00:00",
        "via": [POZNAN],
    },
    {
        "name": "walk only",
        "style": "walk",
        "o": "52.2297,21.0122",
        "d": "52.2288,21.0033",
        "date": "2026-12-01",
        "time": "06:00:00",
        "via": [],
    },
    {
        "name": "spring change (time does not exist)",
        "style": "normal",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-03-29",
        "time": "02:30:00",
        "via": [],
    },
    {
        "name": "autumn change (ambiguous time)",
        "style": "normal",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-10-25",
        "time": "02:30:00",
        "via": [POZNAN],
    },
    {
        "name": "summer time",
        "style": "normal",
        "o": "pl_lublin",
        "d": "defv_gels",
        "date": "2026-07-15",
        "time": "23:45:00",
        "via": [],
    },
]


def main() -> None:
    flix_off = mock.patch.object(
        _flixbus_api,
        "find_city_id",
        side_effect=_flixbus_api.FlixbusApiError("nie pobierane w tej aplikacji: brak serwera"),
    )
    out_cases = []
    for case in CASES:
        recorded: dict[str, dict] = {}

        def fake_plan(
            from_place,
            to_place,
            time,
            max_transfers=4,
            num_itineraries=None,
            _case=case,
            _rec=recorded,
        ):
            key = f"{from_place}|{to_place}|{time}|{max_transfers}|{num_itineraries}"
            payload = world(_case["style"], from_place, to_place, time)
            _rec[key] = payload
            if not motis_client._all_itineraries(payload):
                raise MotisError(
                    Msg(
                        "err.motis_no_itinerary",
                        origin=from_place,
                        destination=to_place,
                        time=time,
                        minutes=motis_client.MAX_WALK_SECONDS // 60,
                    )
                )
            return payload

        def fake_find(ref: StopRef) -> str:
            return f"id:{ref.name}"

        request = RouteRequest(
            origin_stop_id=case["o"],
            destination_stop_id=case["d"],
            origin_label="Start",
            destination_label="Cel",
            date=case["date"],
            departure_time=case["time"],
            discounts=DiscountProfile(**case.get("profile", {})),
        )
        via = [AlternativeStop(v.name, v) for v in case["via"]]
        other_day: list[OtherDayVariant] = []
        with (
            flix_off,
            mock.patch.object(motis_client, "plan", fake_plan),
            mock.patch.object(motis_client, "find_stop_id", fake_find),
        ):
            built, skipped = generate_variants(
                request,
                via_hub_stops=via,
                alternative_origin_stops=case.get("alt_o"),
                alternative_destination_stops=case.get("alt_d"),
                other_day_out=other_day,
            )
            with mock.patch("routing.search_service.discover_hubs", return_value=([], [])):
                result = search(request)
        out_cases.append(
            {
                "name": case["name"],
                "style": case["style"],
                "request": {
                    "origin_stop_id": case["o"],
                    "destination_stop_id": case["d"],
                    "date": case["date"],
                    "departure_time": case["time"],
                    "profile": case.get("profile", {}),
                },
                "via": [
                    {
                        "label": a.label,
                        "stop": {
                            "name": a.stop_id.name,
                            "lat": a.stop_id.lat,
                            "lon": a.stop_id.lon,
                        },
                    }
                    for a in via
                ],
                "alt_origin": [_alt_json(a) for a in case.get("alt_o", [])],
                "alt_destination": [_alt_json(a) for a in case.get("alt_d", [])],
                "motis_time": request.motis_time,
                "plans": recorded,
                "built": [item_json(i) for i in built],
                "skipped": [skipped_json(s) for s in skipped],
                "other_day": [other_json(o) for o in other_day],
                "search": {
                    "built": [item_json(i) for i in result.built],
                    # "Airport selection" entries come from the flight-hub discovery, which is not ported
                    "skipped": [
                        skipped_json(s)
                        for s in result.skipped
                        if not (
                            isinstance(s.variant_name, Msg)
                            and s.variant_name.key == "variant.airport_selection"
                        )
                    ],
                    "other_day": [other_json(o) for o in result.other_day],
                    "recommendations": {k: item_json(v) for k, v in result.recommendations.items()},
                },
            }
        )

    helpers = {
        "detour": [
            [list(o), list(v), list(d), msg_json(variants.via_hub_detour_reason(o, v, d))]
            for o, v, d in [
                ((51.2314, 22.5692), (52.4019, 16.9125), (51.5049, 7.1022)),
                ((50.0678, 19.9475), (52.4019, 16.9125), (49.6568, 21.1597)),
                ((52.2297, 21.0122), (52.4019, 16.9125), (52.2288, 21.0033)),
            ]
        ],
        "local_time": [
            [d, t, variants.RouteRequest("a", "b", "A", "B", d, t).motis_time]
            for d in [
                "2026-03-28",
                "2026-03-29",
                "2026-10-24",
                "2026-10-25",
                "2026-12-31",
                "2027-01-01",
            ]
            for t in [
                "00:00:00",
                "01:59:59",
                "02:00:00",
                "02:30:00",
                "03:00:00",
                "06:00:00",
                "23:59:59",
            ]
        ],
    }
    dump(OUT_DIR / "variants.json", {"places": PLACES, "cases": out_cases, "helpers": helpers})


def _alt_json(a: AlternativeStop) -> dict:
    stop_ref = a.stop_id
    if isinstance(stop_ref, StopRef):
        return {
            "label": a.label,
            "stop": {"name": stop_ref.name, "lat": stop_ref.lat, "lon": stop_ref.lon},
        }
    return {"label": a.label, "stop": stop_ref}


if __name__ == "__main__":
    main()
