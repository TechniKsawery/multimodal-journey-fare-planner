"""Golden vectors for the smaller fares/common modules: BahnCard suggestions, age defaults,
eligibility texts, foreigner warnings and currency conversion.

Output: core/golden/misc.json  (grids: axes + fingerprints; plus small fully-stored sections)
Regenerate:  python tools/golden/generate_misc.py
"""

from dataclasses import asdict
from datetime import date

from golden_common import OUT_DIR, canonical, dump, fnv1a64, outcome, product_cases

from common.currency import convert, normalize_currency, to_pln
from fares.age_defaults import default_discounts_for_age
from fares.cards import suggest_bahncard
from fares.eligibility_info import ELIGIBILITY, explain_ticket
from fares.foreigner_eligibility import warnings_for
from fares.model import Carrier, DiscountProfile


def cards_case(c: dict):
    ref = date.fromisoformat(c["reference_date"])
    res = suggest_bahncard(
        c["distance_km"], c["journeys_per_year"], c["age"], ref, c["existing_bahncard"]
    )
    return [asdict(r) for r in res]


CARD_AXES = {
    "distance_km": [-1, 0, 0.5, 10, 50, 120, 300, 550, 900, 2000],
    "journeys_per_year": [0, 1, 2, 5, 10, 30],
    "age": [None, 5, 6, 10, 18, 19, 22, 26, 27, 40],
    "reference_date": ["2026-10-06", "2026-10-07", "2026-12-12", "2026-12-13"],
    "existing_bahncard": [None, "brak", "25", "50", "100", "xx"],
}
CURRENCY_AXES = {
    "amount": [0, 1, 12.5, 99.99],
    "from": ["PLN", "EUR", "eur", " Pln ", "USD"],
    "to": ["PLN", "EUR", "CZK"],
}


def currency_case(c: dict):
    return {
        "convert": convert(c["amount"], c["from"], c["to"]),
        "to_pln": to_pln(c["amount"], c["from"]),
        "normalize": normalize_currency(c["from"]),
    }


def foreigner_profiles() -> list[dict]:
    out = []
    for cit in (None, "PL", "UE", "poza_UE"):
        for foreign_card in (False, True):
            for pkp in (
                "brak",
                "dzieci_mlodziez_szkolna_do_24_lat",
                "student_do_26_lat_doktorant_do_35_lat",
            ):
                for flags in (
                    {},
                    {"ztm_warszawa_ulgowy": True},
                    {"mpk_krakow_ulgowy": True},
                    {"ztm_poznan_ulgowy": True},
                    {"ztm_lublin_ulgowy": True},
                    {"mpk_wroclaw_ulgowy": True},
                    {"bvg_berlin_ulgowy": True},
                    {"vrr_dziecko": True},
                    {"ztm_warszawa_ulgowy": True, "mpk_krakow_ulgowy": True, "vrr_dziecko": True},
                ):
                    out.append(
                        {
                            "obywatelstwo": cit,
                            "legitymacja_zagraniczna": foreign_card,
                            "pkp_ulga_kod": pkp,
                            **flags,
                        }
                    )
    return out


def main() -> None:
    grids = []
    for name, axes, fn in (
        ("cards", CARD_AXES, cards_case),
        ("currency", CURRENCY_AXES, currency_case),
    ):
        hashes = [fnv1a64(canonical(outcome(fn, c))) for c in product_cases(axes)]
        grids.append({"name": name, "axes": [[k, v] for k, v in axes.items()], "hashes": hashes})

    # A readable subset of card suggestions with the full expected output.
    readable_cards = []
    for c in product_cases(
        {
            "distance_km": [120, 550],
            "journeys_per_year": [2, 10],
            "age": [None, 22, 10],
            "reference_date": ["2026-11-01", "2026-12-13"],
            "existing_bahncard": [None, "25"],
        }
    ):
        readable_cards.append({"in": c, "expect": outcome(cards_case, c)})

    ages = list(range(-3, 121))
    foreigner = [
        {
            "profile": p,
            "expect": [
                {"key": m.key, "params": m.params} for m in warnings_for(DiscountProfile(**p))
            ],
        }
        for p in foreigner_profiles()
    ]
    tickets = [
        {"in": b, "expect": explain_ticket(b)}
        for b in (
            {},
            {"typ_biletu": "bezpłatny (100%)"},
            {"typ_biletu": "ulgowy (50%)"},
            {"typ_biletu": "Einzelkarte dziecko"},
            {"typ_biletu": "normalny"},
            {"typ_biletu": "Ulgowy"},
            {"typ_biletu": None},
        )
    ]
    data = {
        "grids": grids,
        "readable_cards": readable_cards,
        "age_defaults": [{"age": a, "expect": default_discounts_for_age(a)} for a in [None, *ages]],
        "eligibility": {
            c.value: [
                list(map(lambda x: x, v)) if isinstance(v, (list, tuple)) else v for v in vals
            ]
            for c, vals in ELIGIBILITY.items()
        },
        "eligibility_missing": [c.value for c in Carrier if c not in ELIGIBILITY],
        "explain_ticket": tickets,
        "foreigner": foreigner,
    }
    dump(OUT_DIR / "misc.json", data)
    print({k: len(v) for k, v in data.items()})


if __name__ == "__main__":
    main()
