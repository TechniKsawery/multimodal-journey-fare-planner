"""Golden vectors for the place aliases (places/aliases.py) and the per-itinerary BahnCard suggestion
(routing/card_suggestions.py).

Places: every search name of every city in data/places/aliases.json, in several shapes (upper case,
station suffixes, digits, "Oder"-style continuations, unknown text), goes through fold / find_city /
local_query / localize_name / place_text in every interface language. The TypeScript tests rebuild the
same inputs and must reproduce a fingerprint of all results plus a readable named subset.

Cards: all itineraries of 0-3 legs from a catalogue of legs (DB domestic, DB cross-border, PKP IC, bus,
flight, no distance, ...) x a few (age, journeys, existing card, reference date) settings.

Output: core/golden/places.json, core/golden/card_suggestions.json
Regenerate:  python tools/golden/generate_places.py
"""

from datetime import date, datetime

from golden_common import OUT_DIR, canonical, dump, fnv1a64

from places import aliases as A
from routing.card_suggestions import (
    db_distance_km,
    db_flexpreis_upper_bound_total,
    suggest_bahncard_for_itinerary,
)
from routing.model import Itinerary, Leg, LegMode, PricedLeg

SHAPES = [
    "{}",
    "{} Hbf",
    "{}, Hbf",
    "Hbf, {}",
    "{}, Köln",
    "{} 12",
    "  {}",
    "{} Oder",
    "{} an der Oder",
    "{} nad Odrą",
    "{}-Mitte",
    "{} (Oder)",
    "{}!",
]
EXTRA_TEXTS = [
    "",
    " ",
    ",",
    "Praga",
    "Praga Północ",
    "Frankfurt Oder",
    "Frankfurt (Oder) Hbf",
    "Frankfurt am Main",
    "Frankfurt an der Oder",
    "Landsberg an der Warthe",
    "Strasse 5, Köln",
    "Köln, Köln",
    "München Hbf, München",
    "Ünknown City",
    "STRASSE ß Łódź ŁÓDŹ",
    "İstanbul",
    "Zażółć gęślą jaźń",
]
LANGS = [*A.LANGUAGES, None, "xx"]


def inputs() -> list[str]:
    names = []
    for city in A.load_cities():
        names.extend(city.search_names())
    out = []
    for n in dict.fromkeys(names):
        for shape in SHAPES:
            out.append(shape.format(n))
        out.append(n.upper())
        out.append(n.lower())
    out.extend(EXTRA_TEXTS)
    return list(dict.fromkeys(out))


def row(text: str) -> list:
    city = A.find_city(text)
    return [
        A.fold(text),
        city.key if city else None,
        A.local_query(text),
        [list(A.localize_name(text, lang)) for lang in LANGS],
        [A.place_text(text, lang) for lang in LANGS],
        A.place_text(text, "en", "{local} -> {shown}"),
    ]


NAMED = [
    "Krakau",
    "Cologne",
    "Monachium",
    "Koeln",
    "Köln Hbf",
    "Frankfurt Oder",
    "Frankfurt (Oder) Hbf",
    "Praga",
    "Krakau, Hbf",
    "Berlin",
    "Landsberg an der Warthe",
    "Wien Hbf, Wien",
]

# ---- cards ----
D = datetime(2026, 12, 1, 8, 0)
E = datetime(2026, 12, 1, 10, 0)


def leg(mode, carrier, km, o, d):
    extra = {}
    if o:
        extra.update(origin_lat=o[0], origin_lon=o[1])
    if d:
        extra.update(destination_lat=d[0], destination_lon=d[1])
    return Leg(
        mode=mode,
        origin_name="A",
        destination_name="B",
        depart=D,
        arrive=E,
        carrier_name=carrier,
        distance_km=km,
        extra=extra,
    )


HAMM = (51.6781, 7.8083)
BERLIN = (52.5251, 13.3694)
MUNICH = (48.1403, 11.5601)
WARSAW = (52.2288, 21.0033)
LUBLIN = (51.2465, 22.5684)
CATALOGUE = {
    "db300": leg(LegMode.RAIL, "DB Fernverkehr AG", 300.0, HAMM, BERLIN),
    "db700": leg(LegMode.RAIL, "Deutsche Bahn", 700.0, BERLIN, MUNICH),
    "db_short": leg(LegMode.RAIL, "DB", 120.0, HAMM, HAMM),
    "db_cross": leg(LegMode.RAIL, "DB Fernverkehr AG", 570.0, BERLIN, WARSAW),
    "db_nodist": leg(LegMode.RAIL, "DB Fernverkehr AG", None, HAMM, BERLIN),
    "db_zero": leg(LegMode.RAIL, "DB Fernverkehr AG", 0.0, HAMM, BERLIN),
    "ic_pl": leg(LegMode.RAIL, "PKP Intercity", 400.0, WARSAW, LUBLIN),
    "regio_de": leg(LegMode.RAIL, "DB Regio AG NRW", 100.0, HAMM, HAMM),
    "flix": leg(LegMode.BUS, "FlixBus", 500.0, BERLIN, MUNICH),
    "flight": leg(LegMode.FLIGHT, "Lufthansa", 800.0, BERLIN, MUNICH),
}
KEYS = list(CATALOGUE)
SETTINGS = [
    {"age": None, "journeys": 2, "existing": None, "ref": "2026-11-21"},
    {"age": 17, "journeys": 6, "existing": None, "ref": "2026-11-21"},
    {"age": 30, "journeys": 1, "existing": "25", "ref": "2027-02-01"},
    {"age": 67, "journeys": 12, "existing": "50", "ref": "2026-11-21"},
    {"age": 40, "journeys": 4, "existing": "100", "ref": "2026-11-21"},
]


def itinerary(keys):
    legs = [
        PricedLeg(leg=CATALOGUE[k], amount=0.0, currency="EUR", price_type="szacunek") for k in keys
    ]
    return Itinerary(
        variant_name="x", legs=legs, total_price_pln=0.0, total_duration_min=0.0, num_transfers=0
    )


def sequences():
    seqs = [[]]
    for n in (1, 2, 3):
        seqs += [list(c) for c in _product(n)]
    return seqs


def _product(n):
    import itertools

    return itertools.product(KEYS, repeat=n)


def card_row(keys, s):
    it = itinerary(keys)
    sug = suggest_bahncard_for_itinerary(
        it,
        age=s["age"],
        journeys_per_year=s["journeys"],
        existing_bahncard=s["existing"],
        reference_date=date.fromisoformat(s["ref"]),
    )
    return [
        round(db_distance_km(it), 2),
        db_flexpreis_upper_bound_total(it),
        [
            [
                c.variant_key,
                c.cena_karty,
                c.cena_biletu_bez_karty,
                c.cena_biletu_z_karta,
                c.oszczednosc_rocznie,
                c.journeys_needed_to_break_even,
                c.rekomendowana,
                c.opis,
            ]
            for c in sug
        ],
    ]


def main() -> None:
    texts = inputs()
    rows = [row(t) for t in texts]
    dump(
        OUT_DIR / "places.json",
        {
            "languages": LANGS,
            "shapes": SHAPES,
            "extra_texts": EXTRA_TEXTS,
            "count": len(rows),
            "hash": fnv1a64(canonical(rows)),
            "alias_names_hash": fnv1a64(canonical(A.alias_names())),
            "city_keys": [c.key for c in A.load_cities()],
            "named": [{"text": t, "result": row(t)} for t in NAMED],
        },
    )
    seqs = sequences()
    results = [card_row(k, s) for s in SETTINGS for k in seqs]
    named = [
        {"keys": k, "setting": i, "result": card_row(k, SETTINGS[i])}
        for k, i in (
            (["db300"], 0),
            (["db300", "db700"], 1),
            (["db_cross"], 0),
            (["db300", "ic_pl", "flix"], 3),
            (["db300"], 4),
            (["db_nodist", "db_zero"], 0),
            (["db700"], 2),
        )
    ]
    dump(
        OUT_DIR / "card_suggestions.json",
        {
            "keys": KEYS,
            "settings": SETTINGS,
            "count": len(results),
            "hash": fnv1a64(canonical(results)),
            "nonempty": sum(1 for r in results if r[2]),
            "named": named,
        },
    )


if __name__ == "__main__":
    main()
