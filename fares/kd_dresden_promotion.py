"""Oferta stałych cen "Dresden Promotion" (Koleje Dolnośląskie + Die Länderbahn): jeden bilet z wybranej
stacji w Polsce do Drezna Hbf. Dane: data/fares/kd_dresden_promotion.json (odczyt stron operatora 2026-11-21).

Źródła nie mówią wprost, że oferta jest dziś w sprzedaży (`oferta_aktualna_potwierdzona=false`), więc cena
z tego modułu jest ZAWSZE niepotwierdzonym szacunkiem — wywołujący ustawia price_verified=False.
Stacje spoza tabeli nie mają ceny (nie zgadujemy)."""

from places.aliases import fold

from ._data_loading import load

_TABLE = load("kd_dresden_promotion.json")

CHILD_MIN_AGE = 6
CHILD_MAX_AGE = 15


def _station_key(name: str) -> str:
    """Nazwa stacji z tabeli bez dopisku w nawiasie ("Zgorzelec (niedostępne w kanałach internetowych)")."""
    return fold(name.split("(")[0])


_STATIONS = {_station_key(row["stacja"]): row for row in _TABLE["ceny_za_osobe_do_drezna_hbf"]}
DRESDEN_HBF_NAMES = frozenset({"dresden hbf", "dresden hauptbahnhof", "drezno glowne"})


def is_offer_origin(name: str) -> bool:
    return fold(name) in _STATIONS


def is_dresden_hbf(name: str) -> bool:
    return fold(name) in DRESDEN_HBF_NAMES


def one_way_price(origin: str, age: int | None = None) -> tuple[float, str] | None:
    """(cena w PLN za przejazd w jedną stronę, podstawa) albo None, gdy stacji nie ma w tabeli lub dla wieku
    poniżej 6 lat (źródło: bezpłatnie z pasażerem pełnopłatnym — to nie jest cena tego biletu)."""
    row = _STATIONS.get(fold(origin))
    if row is None:
        return None
    if age is not None and age < CHILD_MIN_AGE:
        return None
    if age is not None and CHILD_MIN_AGE <= age <= CHILD_MAX_AGE:
        return float(row["w_jedna_strone_dziecko_6_15"]), "dziecko_6_15"
    return float(row["w_jedna_strone"]), "dorosly"


def source_info() -> dict:
    return {
        "zrodlo_url": _TABLE["zrodlo_url"],
        "data_weryfikacji": _TABLE["data_weryfikacji"],
        "oferta_aktualna_potwierdzona": bool(_TABLE["oferta_aktualna_potwierdzona"]),
    }
