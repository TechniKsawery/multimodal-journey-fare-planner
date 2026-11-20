"""Golden vectors for the attractions module: city detection, catalogue loading, working-note
filter, localized texts, best price per profile and the city-card calculator.

Output: core/golden/attractions.json
Regenerate:  python tools/golden/generate_attractions.py
"""

from dataclasses import asdict
from datetime import date

from golden_common import OUT_DIR, canonical, dump, fnv1a64, outcome

from attractions.model import AttractionCategory, HeldDocument
from attractions.service import (
    DiscountProfile,
    best_price_for_attraction,
    evaluate_city_cards,
    get_all_attractions,
    get_all_city_cards,
    get_attractions,
    get_city_cards,
    has_working_note,
    is_closed,
    localized_description,
    normalize_city,
    price_from_note,
    public_text,
    suggest_best_city_card,
)

H = HeldDocument
CITY_QUERIES = [
    None,
    "",
    " ",
    "Lublin",
    "Ulica 1, Lublin",
    "Lublin, Polska",
    "Kraków",
    "KRAKOW, Poland",
    "Köln Hbf",
    "Cologne",
    "Kolonia",
    "München",
    "Munich, Germany",
    "Monachium",
    "Warsaw",
    "Warszawa Centralna",
    "Poznań Główny",
    "wrocław",
    "Wrocław, Dworzec",
    "Essen",
    "Dortmund Hbf",
    "Ruhr",
    "VRR",
    "Gelsenkirchen-Buer",
    "buer",
    "Hamburg",
    "Berlin, Hbf",
    "Berlin, Lublin",
    "Lublin, Berlin",
    "Reykjavik",
    "xessenx",
    "essenz",
    "_berlin_",
    "Berlin2",
    "Aberlin",
    "Zürich",
    "Lublin,,",
    ",Berlin",
    "  Krakow  ,  ",
]
LANGS = [None, "", "pl", "en", "de", "es", "fr", "nl", "xx", "__proto__"]
TEXTS = [
    "",
    "Zwykły opis atrakcji.",
    "Opis. POPRAWKA 2026-10-10: cena inna.",
    "Opis (wg Gemini). Drugie zdanie bez uwag.",
    "Cena 10 EUR (potwierdzone na stronie). Reszta.",
    "Cena 10 EUR (NIEPOTWIERDZONE u źródła). Reszta zdania.",
    "Zdanie z url www.example.com/cennik. Inne zdanie.",
    "Alles gut. KORREKTUR: anders. Danach ok.",
    "Open daily. CONFIRMED LIVE on site. Tickets online.",
    "Date 2026-11-02 should be removed. Keep this one.",
    "Hotel Gemini ok.",
    "geminis are fine",
    "niepotwierdzone u źródła, ale tak",
    "certificate has expired",
    "Wszystko jest notatką. POPRAWKA 2026-01-01.",
    "Prueba adicional aquí. Resto.",
    "Preuve supplémentaire ici. Reste.",
    "extra bewijs hier. Rest.",
    "Zdanie jeden! Zdanie dwa? POTWIERDZONE tak. Koniec.",
    "ünbestätigt UNBESTÄTIGT hier. Weiter.",
    "(nawias bez notatki) tekst (POPRAWKA 2026-10-10) koniec.",
    "a (b (POPRAWKA) c) d.",
    "Ćwiczenie 2026-10-10x nie jest datą? Jest. Zostaje reszta.",
]
DATES = ["2020-01-01", "2028-12-30", "2028-12-31", "2029-01-01", "2026-11-20"]

DOC_SETS = [
    [],
    [H("legitymacja_studencka", "PL")],
    [H("legitymacja_szkolna", "DE")],
    [H("ISIC", "DE")],
    [H("karta_seniora", "PL")],
    [H("legitymacja_studencka", "PL"), H("legitymacja_szkolna", "DE")],
    [H("karta_rodzinna", "PL")],
]


def profiles() -> list[DiscountProfile | None]:
    out: list[DiscountProfile | None] = [None]
    for age in (None, 5, 12, 17, 26, 67):
        for is_student in (False, True):
            for is_senior in (False, True):
                for docs in DOC_SETS:
                    out.append(DiscountProfile(age, is_student, is_senior, list(docs)))
    return out


def profile_json(p):
    return None if p is None else asdict(p)


def main() -> None:
    attractions = get_all_attractions()
    cards = get_all_city_cards()
    profs = profiles()
    eval_profs = profs[:: max(1, len(profs) // 24)]

    city_ids = sorted({a.city for a in attractions} | {c.city for c in cards})
    subsets = {}
    for city in city_ids:
        in_city = get_attractions(city, include_closed=True)
        subsets[city] = {
            "all": [a.id for a in in_city],
            "first": [a.id for a in in_city[:1]],
            "three": [a.id for a in in_city[:3]],
            "none": [],
        }
    mixed = [a.id for a in attractions if a.city in ("berlin", "krakow", "lublin")]
    by_id = {a.id: a for a in attractions}

    data: dict = {
        "city_queries": [[q, normalize_city(q)] for q in CITY_QUERIES],
        "attractions": [asdict(a) for a in attractions],
        "city_cards": [asdict(c) for c in cards],
        "city_cards_by_city": {
            c: [x.id for x in get_city_cards(c)] for c in [None, *city_ids, "xx"]
        },
        "attractions_filters": [
            {"city": city, "category": cat, "ids": [a.id for a in get_attractions(city, cat, True)]}
            for city in (None, "Berlin", "Lublin, Polska", "Köln", "nowhere")
            for cat in (None, *[c.value for c in AttractionCategory])
        ],
        "texts": [[t, has_working_note(t), public_text(t)] for t in TEXTS],
        "closed": [
            [a.id, d, is_closed(a, date.fromisoformat(d))]
            for a in attractions
            for d in DATES
            if a.closed_until
        ],
        "closed_none": [
            is_closed(a, date.fromisoformat(d)) for a in attractions[:5] for d in DATES
        ],
        "profile_count": len(profs),
        "eval_profile_count": len(eval_profs),
        "doc_sets": [[asdict(d) for d in docs] for docs in DOC_SETS],
        "subsets": subsets,
        "mixed": mixed,
    }

    grids = []

    def grid(name: str, axes: list, cases: list) -> None:
        grids.append({"name": name, "axes": axes, "hashes": [fnv1a64(canonical(c)) for c in cases]})

    ids = [a.id for a in attractions]
    grid(
        "localized",
        [["attraction", ids], ["lang", LANGS]],
        [
            {"d": localized_description(by_id[i], lang), "n": price_from_note(by_id[i], lang)}
            for i in ids
            for lang in LANGS
        ],
    )
    # profiles are enumerated by the test in the same order (see DOC_SETS/profiles())
    grid(
        "best_price",
        [["attraction", ids], ["profile", list(range(len(profs)))]],
        [_best(best_price_for_attraction(by_id[i], p)) for i in ids for p in profs],
    )

    eval_cases = []
    eval_axes = [
        ["city", city_ids],
        ["subset", ["all", "first", "three", "none", "mixed"]],
        ["transit", [0, 12.5, 80]],
        ["profile", list(range(len(eval_profs)))],
    ]
    for city in city_ids:
        for subset in ("all", "first", "three", "none", "mixed"):
            sel = mixed if subset == "mixed" else subsets[city][subset]
            sel_attr = [by_id[i] for i in sel]
            for transit in (0, 12.5, 80):
                for p in eval_profs:
                    evs = evaluate_city_cards(city, sel_attr, transit, p)
                    best = suggest_best_city_card(city, sel_attr, transit, p)
                    eval_cases.append(
                        {
                            "evals": [asdict(e) for e in evs],
                            "best": None if best is None else asdict(best),
                        }
                    )
    grid("evaluate", eval_axes, eval_cases)
    data["grids"] = grids
    data["readable_eval"] = [
        {
            "city": "krakow",
            "ids": subsets["krakow"]["all"],
            "transit": 40,
            "profile": profile_json(p),
            "evals": [
                asdict(e)
                for e in evaluate_city_cards(
                    "krakow", [by_id[i] for i in subsets["krakow"]["all"]], 40, p
                )
            ],
        }
        for p in (None, DiscountProfile(age=20, is_student=True), DiscountProfile(age=70))
    ]
    data["errors"] = {
        "bad_category": outcome(get_attractions, None, "nie_ma_takiej"),
    }
    dump(OUT_DIR / "attractions.json", data)


def _best(res):
    price, label, gp = res
    return {"price": price, "label": label, "gp": None if gp is None else asdict(gp)}


if __name__ == "__main__":
    main()
