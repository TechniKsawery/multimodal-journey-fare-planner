"""Tryby MOTIS 2 (Transitous) -> LegMode: klasy pociągów to kolej, w tym LONG_DISTANCE (IC/EC)."""

import pytest

from routing import motis_client
from routing.model import LegMode


def _itinerary(mode: str) -> dict:
    return {
        "legs": [
            {
                "mode": mode,
                "agencyName": "PKP Intercity",
                "routeShortName": "IC 1",
                "from": {"name": "Lublin Główny", "lat": 51.2314, "lon": 22.5692},
                "to": {"name": "Warszawa Zachodnia", "lat": 52.2203, "lon": 20.9657},
                "startTime": "2026-12-01T06:00:00Z",
                "endTime": "2026-12-01T08:00:00Z",
            }
        ]
    }


@pytest.mark.parametrize(
    "mode",
    [
        "RAIL",
        "HIGHSPEED_RAIL",
        "LONG_DISTANCE",
        "NIGHT_RAIL",
        "REGIONAL_FAST_RAIL",
        "REGIONAL_RAIL",
    ],
)
def test_klasy_pociagow_to_kolej(mode):
    assert motis_client.itinerary_to_legs(_itinerary(mode))[0].mode is LegMode.RAIL


@pytest.mark.parametrize("mode", ["BUS", "COACH", "TRAM", "SUBWAY", "SUBURBAN"])
def test_transport_lokalny_i_autokary_to_bus(mode):
    assert motis_client.itinerary_to_legs(_itinerary(mode))[0].mode is LegMode.BUS
