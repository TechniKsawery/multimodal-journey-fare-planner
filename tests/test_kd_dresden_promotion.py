"""Oferta KD "Dresden Promotion": jeden bilet za ciąg odcinków KD/Länderbahn do Drezna Hbf, zawsze szacunek."""

from datetime import datetime, timedelta

from fares.model import DiscountProfile
from routing.model import Leg, LegMode
from routing.pricing import apply_kd_dresden_promotion, price_leg

KD = "Koleje Dolnośląskie S.A."
DLB = "Die Länderbahn GmbH DLB"


def _leg(carrier, a, b, n=0, motis_mode="REGIONAL_RAIL"):
    t = datetime(2026, 12, 1, 6, 0) + timedelta(hours=n)
    return Leg(
        mode=LegMode.RAIL,
        origin_name=a,
        destination_name=b,
        depart=t,
        arrive=t + timedelta(minutes=50),
        carrier_name=carrier,
        distance_km=100.0,
        extra={"motis_mode": motis_mode},
    )


def _apply(legs, **profile):
    p = DiscountProfile(**profile)
    return apply_kd_dresden_promotion(legs, [price_leg(leg, p) for leg in legs], p)


def test_bundle_prices_whole_run_once_as_unconfirmed_estimate():
    out = _apply([_leg(KD, "Wrocław Główny", "Görlitz"), _leg(DLB, "Görlitz", "Dresden Hbf", 1)])
    assert [p.amount for p in out] == [90.0, 0.0]
    assert all(not p.price_verified and p.price_type == "szacunek" for p in out)
    assert "zrodlo_url" in out[0].breakdown and "data_weryfikacji" in out[0].breakdown


def test_child_fare_and_under_six():
    legs = [_leg(KD, "Wrocław Główny", "Görlitz"), _leg(DLB, "Görlitz", "Dresden Hbf", 1)]
    assert _apply(legs, age=10)[0].amount == 45.0
    assert not _apply(legs, age=5)[0].breakdown.get("kd_dresden_promotion")


def test_no_match_leaves_prices_alone():
    legs = [_leg(KD, "Legnica Piekary", "Görlitz"), _leg(DLB, "Görlitz", "Dresden Hbf", 1)]
    assert not any(p.breakdown.get("kd_dresden_promotion") for p in _apply(legs))
    legs = [_leg(KD, "Wrocław Główny", "Görlitz"), _leg("DB Regio AG", "Görlitz", "Dresden Hbf", 1)]
    assert not any(p.breakdown.get("kd_dresden_promotion") for p in _apply(legs))
    bus = [
        _leg(KD, "Wrocław Główny", "Görlitz", motis_mode="BUS"),
        _leg(DLB, "Görlitz", "Dresden Hbf", 1),
    ]
    assert not any(p.breakdown.get("kd_dresden_promotion") for p in _apply(bus))


def test_direct_zgorzelec_dresden_is_not_part_of_the_offer():
    out = _apply([_leg(DLB, "Zgorzelec", "Dresden Hbf")])
    assert not out[0].breakdown.get("kd_dresden_promotion")
