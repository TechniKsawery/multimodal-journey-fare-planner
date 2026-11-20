"""Deutschlandticket / BahnCard 100: odcinki lokalne i regionalne w DE = 0 EUR dopłaty, reszta bez zmian."""

import pytest

from fares.model import DiscountProfile
from routing import motis_client
from routing.pricing import price_leg

HAMM = ("Hamm(Westf)Hbf", 51.6781, 7.8083)
GELSEN = ("Gelsenkirchen Hbf", 51.5049, 7.1022)
BERLIN = ("Berlin Hbf", 52.5251, 13.3694)
HAMBURG = ("Hamburg Hbf", 53.553, 10.0063)
BERLIN_OST = ("Berlin Ostbahnhof", 52.5107, 13.4346)
SLUBICE = ("Słubice", 52.3498, 14.5617)
FRANKFURT_ODER = ("Frankfurt (Oder)", 52.3359, 14.5459)


def _leg(mode, agency, route, a, b):
    raw = {
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
    return motis_client.itinerary_to_legs(raw)[0]


HOLDERS = [DiscountProfile(deutschlandticket=True), DiscountProfile(bahncard="100")]


@pytest.mark.parametrize("profile", HOLDERS)
@pytest.mark.parametrize(
    "args",
    [
        ("REGIONAL_FAST_RAIL", "DB Regio AG NRW", "RE 3", HAMM, GELSEN),
        ("REGIONAL_RAIL", "ODEG", "RB 26", BERLIN, HAMBURG),
        ("SUBURBAN", "S-Bahn Berlin GmbH", "S5", BERLIN, BERLIN_OST),
        ("BUS", "BVG", "100", BERLIN, BERLIN_OST),
        ("TRAM", "BVG", "M4", BERLIN, BERLIN_OST),
    ],
)
def test_lokalne_i_regionalne_w_niemczech_sa_za_darmo(profile, args):
    priced = price_leg(_leg(*args), profile)
    assert priced.amount == 0.0 and priced.currency == "EUR"
    assert priced.price_verified
    assert priced.breakdown["deutschlandticket"] is True
    assert priced.breakdown["zrodlo_url"].startswith("https://www.bahn.de/")
    assert priced.breakdown["data_weryfikacji"] == "2026-11-20"


@pytest.mark.parametrize("profile", HOLDERS)
@pytest.mark.parametrize(
    "args",
    [
        ("HIGHSPEED_RAIL", "DB Fernverkehr AG", "ICE 845", BERLIN, HAMBURG),
        ("LONG_DISTANCE", "FlixTrain", "FLX 20", BERLIN, HAMBURG),
        ("COACH", "FlixBus", "N120", BERLIN, HAMBURG),
        ("NIGHT_RAIL", "ÖBB", "NJ 40421", BERLIN, HAMBURG),
        ("RAIL", "ODEG", "RE1", BERLIN, HAMBURG),
        ("REGIONAL_RAIL", "ODEG", "RB 60", FRANKFURT_ODER, SLUBICE),
    ],
)
def test_dalekobiezne_autokary_i_transgraniczne_nie_sa_objete(profile, args):
    priced = price_leg(_leg(*args), profile)
    assert not priced.breakdown.get("deutschlandticket")


def test_bez_biletu_nic_sie_nie_zmienia():
    leg = _leg("REGIONAL_FAST_RAIL", "DB Regio AG NRW", "RE 3", HAMM, GELSEN)
    assert price_leg(leg, DiscountProfile()).amount > 0
    assert not price_leg(leg, DiscountProfile(bahncard="50")).breakdown.get("deutschlandticket")


def test_ire_tylko_dla_bahncard_100():
    leg = _leg("REGIONAL_FAST_RAIL", "DB Regio AG NRW", "IRE 1", HAMM, GELSEN)
    assert price_leg(leg, DiscountProfile(deutschlandticket=True)).amount > 0
    assert price_leg(leg, DiscountProfile(bahncard="100")).amount == 0.0


def test_bahncard_100_w_fernverkehrze_jest_potwierdzona_zrodlem():
    leg = _leg("HIGHSPEED_RAIL", "DB Fernverkehr AG", "ICE 845", BERLIN, HAMBURG)
    priced = price_leg(leg, DiscountProfile(bahncard="100"))
    assert priced.amount == 0.0 and priced.price_verified
    assert not price_leg(leg, DiscountProfile(bahncard="50")).price_verified
