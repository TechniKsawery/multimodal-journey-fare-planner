"""Golden vectors for routing/model.py, transfers.py and scoring.py (build_itinerary,
pick_recommendations, cheaper_unverified, price_ranking_note) on seeded synthetic scenarios.

Output: core/golden/scoring.json. Regenerate:  python tools/golden/generate_scoring.py
"""

import math
import random
from datetime import UTC, datetime, timedelta, timezone
from functools import reduce
from operator import add

from golden_common import OUT_DIR, dump

from fares.model import Carrier
from routing.model import Itinerary, Leg, LegMode, PricedLeg
from routing.scoring import (
    RECOMMENDATION_LABELS,
    build_itinerary,
    cheaper_unverified,
    pick_recommendations,
    price_ranking_note,
)

PLACES = [
    "Lublin Główny",
    "Dworzec Lublin",
    "Dworzec Lublin - Kunickiego",
    "Warszawa Centralna",
    "Berlin Hbf",
    "Berlin-Lichtenberg",
    "S+U Lichtenberg Bhf (Berlin)",
    "Gelsenkirchen Hbf",
    "Kraków Główny",
    "Frankfurt (Oder)",
    "Poznań Główny",
    "Waw Chopin Airport",
    "Berlin BER",
]
CARRIERS = [
    "PKP Intercity",
    "DB Fernverkehr AG",
    "POLREGIO",
    "Ryanair",
    "FlixBus",
    "",
    "S-Bahn Berlin GmbH",
]
CURRENCIES = ["PLN", "EUR"]
TZS = [UTC, timezone(timedelta(hours=1)), timezone(timedelta(hours=2))]


def msg_json(m):
    if hasattr(m, "key"):
        return {"key": m.key, "params": {k: msg_json(v) for k, v in m.params.items()}}
    return m


def leg_json(leg: Leg) -> dict:
    return {
        "mode": leg.mode.value,
        "origin_name": leg.origin_name,
        "destination_name": leg.destination_name,
        "depart": leg.depart.isoformat(),
        "arrive": leg.arrive.isoformat(),
        "carrier_name": leg.carrier_name,
        "distance_km": leg.distance_km,
        "requires_walk": leg.requires_walk,
        "extra": leg.extra,
    }


def priced_json(pl: PricedLeg) -> dict:
    return {
        "leg": leg_json(pl.leg),
        "amount": pl.amount,
        "currency": pl.currency,
        "price_type": pl.price_type,
        "notes": pl.notes,
        "breakdown": pl.breakdown,
        "carrier": pl.carrier.value if pl.carrier else None,
    }


def make_variant(rng: random.Random, base: datetime) -> list[PricedLeg]:
    n = rng.randint(1, 5)
    t = base + timedelta(minutes=rng.randint(0, 600))
    legs: list[PricedLeg] = []
    place = rng.choice(PLACES)
    for _ in range(n):
        mode = rng.choice([LegMode.RAIL, LegMode.RAIL, LegMode.BUS, LegMode.FLIGHT, LegMode.WALK])
        gap = rng.choice([0, 2, 5, 9, 15, 25, 35, 50, 70, 100, 130, 200])
        depart = t + timedelta(minutes=gap)
        dur = rng.choice([8, 20, 45, 90, 180, 400])
        arrive = depart + timedelta(minutes=dur)
        dest = rng.choice(PLACES)
        extra = {}
        if mode is LegMode.FLIGHT and rng.random() < 0.5:
            extra["checked_baggage"] = rng.choice([True, False, 0, [], "x"])
        leg = Leg(
            mode=mode,
            origin_name=place if rng.random() < 0.7 else rng.choice(PLACES),
            destination_name=dest,
            depart=depart,
            arrive=arrive,
            carrier_name=rng.choice(CARRIERS),
            distance_km=rng.choice([None, 12.5, 80, 340]),
            requires_walk=rng.random() < 0.7,
            extra=extra,
        )
        breakdown: dict = {}
        r = rng.random()
        if r < 0.1:
            breakdown["cena_nieznana"] = True
        elif r < 0.2:
            breakdown["wartosc_zastepcza"] = True
        elif r < 0.3:
            breakdown["price_verified"] = rng.choice([True, False])
        if rng.random() < 0.15:
            breakdown["zakres_cen"] = {"od": 10.0, "do": 25.5, "waluta": rng.choice(CURRENCIES)}
        legs.append(
            PricedLeg(
                leg=leg,
                amount=round(rng.choice([0, 4.5, 19.99, 45, 120.25, 300]), 2),
                currency=rng.choice(CURRENCIES),
                price_type=rng.choice(["szacunek", "oficjalna_taryfa"]),
                breakdown=breakdown,
                carrier=rng.choice([None, Carrier.DB, Carrier.PKP_INTERCITY]),
            )
        )
        t, place = arrive, dest
    return legs


def itinerary_json(it: Itinerary) -> dict:
    return {
        "variant_name": it.variant_name,
        "total_price_pln": it.total_price_pln,
        "total_price_pln_high": it.total_price_pln_high,
        "total_duration_min": it.total_duration_min,
        "num_transfers": it.num_transfers,
        "price_verified": it.price_verified,
        "price_status": it.price_status,
        "is_infeasible": it.is_infeasible,
        "is_risky": it.is_risky,
        "price_per_hour": it.price_per_hour if it.total_duration_min > 0 else "inf",
        "num_carriers": it.num_carriers,
        "num_risky_transfers": it.num_risky_transfers,
        "value_score": it.value_score,
        "is_safe_fallback": it.is_safe_fallback,
        "legs_flags": [[pl.price_known, pl.price_verified, pl.unverified_label] for pl in it.legs],
        "transfer_warnings": [
            {
                "after_leg_index": w.after_leg_index,
                "gap_minutes": w.gap_minutes,
                "minimum_required_minutes": w.minimum_required_minutes,
                "reason": msg_json(w.reason),
                "infeasible": w.infeasible,
            }
            for w in it.transfer_warnings
        ],
    }


def naive_sum(values, start=0):
    """Left-to-right float addition (what the TypeScript port does). CPython >= 3.12 compensates
    sum() of floats, 3.11 does not, so the expected values are always computed with this one."""
    return reduce(add, values, start)


def exact_sum(values, start=0):
    return math.fsum([start, *values])


def build_with(sum_fn, name, legs):
    import routing.scoring as scoring_module

    scoring_module.sum = sum_fn  # shadows the builtin inside routing.scoring only
    try:
        return build_itinerary(name, legs)
    finally:
        del scoring_module.sum


def main() -> None:
    rng = random.Random(20261120)
    scenarios = []
    while len(scenarios) < 220:
        base = datetime(2026, 12, 1, 6, 0, tzinfo=rng.choice(TZS))
        variants_in = [make_variant(rng, base) for _ in range(rng.randint(1, 6))]
        its = [build_with(naive_sum, f"v{k}", v) for k, v in enumerate(variants_in)]
        exact = [build_with(exact_sum, f"v{k}", v) for k, v in enumerate(variants_in)]
        # Skip (synthetic) scenarios where float summation order changes a rounded total.
        if any(
            (a.total_price_pln, a.total_price_pln_high)
            != (b.total_price_pln, b.total_price_pln_high)
            for a, b in zip(its, exact, strict=True)
        ):
            continue
        out = {
            "variants": [itinerary_json(i) for i in its],
            "recommendations": None,
            "error": None,
            "notes": {},
            "cheaper_unverified": {},
        }
        try:
            rec = pick_recommendations(its)
            out["recommendations"] = {k: v.variant_name for k, v in rec.items()}
            out["variants_after"] = [i.is_safe_fallback for i in its]
            for key, chosen in rec.items():
                note = price_ranking_note(key, chosen, its)
                out["notes"][key] = msg_json(note) if note is not None else None
                if key in ("najtansza", "najtansza_bezpieczna"):
                    out["cheaper_unverified"][key] = [
                        i.variant_name for i in cheaper_unverified(its, chosen)
                    ]
        except ValueError as e:
            out["error"] = str(e)
        scenarios.append(
            {"variants_in": [[priced_json(pl) for pl in v] for v in variants_in], "expect": out}
        )
    data = {
        "labels": RECOMMENDATION_LABELS,
        "scenarios": scenarios,
        "empty_variant_error": _empty_error(),
    }
    dump(OUT_DIR / "scoring.json", data)
    errors = sum(1 for s in scenarios if s["expect"]["error"])
    print(f"scenarios: {len(scenarios)} (pick_recommendations errors: {errors})")


def _empty_error() -> str:
    try:
        build_itinerary("x", [])
    except ValueError as e:
        return str(e)
    return ""


if __name__ == "__main__":
    main()
