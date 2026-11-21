"""Deutschlandticket i BahnCard 100: odcinki lokalne/regionalne w Niemczech dla POSIADACZA = 0 EUR dopłaty.

To NIE jest kalkulator ceny biletu (cena abonamentu: data/fares/deutschlandticket.json::cena_miesieczna),
tylko reguła "czy ten odcinek jest już opłacony posiadanym biletem". Zakres wyłącznie z cytatów w
data/fares/deutschlandticket.json::zakres_posiadacza (bahn.de, zweryfikowano 2026-11-20)."""

import re

from ._data_loading import load
from .model import DiscountProfile

_TABLE = load("deutschlandticket.json")
SCOPE = _TABLE["zakres_posiadacza"]

BASIS_DEUTSCHLANDTICKET = "deutschlandticket"
BASIS_BAHNCARD_100 = "bahncard_100"

# Znaczniki pociągów dalekobieżnych w nazwie linii (pomocniczo, obok trybu MOTIS i nazwy przewoźnika).
LONG_DISTANCE_LINE = re.compile(
    r"^(?:ICE|IC|EC|ECE|EN|NJ|RJX?|FLX|TGV)(?:\s*-?\d+[A-Za-z]?)?$", re.IGNORECASE
)
IRE_LINE = re.compile(r"^IRE(?:\s*-?\d+[A-Za-z]?)?$", re.IGNORECASE)


def holder_basis(discounts: DiscountProfile) -> str | None:
    """Skąd posiadacz ma darmowy dostęp: BahnCard 100 (ma wliczone Deutschlandticket) albo samo
    Deutschlandticket. None = nie ma żadnego z nich."""
    if discounts.bahncard == "100":
        return BASIS_BAHNCARD_100
    if discounts.deutschlandticket:
        return BASIS_DEUTSCHLANDTICKET
    return None


def source_info(basis: str) -> dict:
    """Źródło i data dla breakdown (BahnCard 100: źródło BC100 + źródło zakresu D-Ticket)."""
    if basis == BASIS_BAHNCARD_100:
        bc = SCOPE["bahncard_100"]
        return {
            "zrodlo_url": bc["zrodlo_url"],
            "zrodlo_zakresu_url": SCOPE["zrodlo_url"],
            "data_weryfikacji": bc["data_weryfikacji"],
            "cytat": bc["cytat_deutschlandticket"],
        }
    return {
        "zrodlo_url": SCOPE["zrodlo_url"],
        "data_weryfikacji": SCOPE["data_weryfikacji"],
        "cytat": SCOPE["cytat_obowiazuje"],
    }


def line_allowed(route_short_name: str, basis: str) -> bool:
    """Linia nie jest dalekobieżna; IRE tylko dla BahnCard 100 (jej źródło wymienia IRE, strona
    Deutschlandticket nie)."""
    name = (route_short_name or "").strip()
    if LONG_DISTANCE_LINE.match(name):
        return False
    return not (IRE_LINE.match(name) and basis != BASIS_BAHNCARD_100)
