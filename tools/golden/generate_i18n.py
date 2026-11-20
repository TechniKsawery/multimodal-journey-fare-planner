"""i18n for the TypeScript core: the six language dictionaries as JSON (core/src/i18n/locales/*.json,
consumed by the app) and golden vectors of Msg rendering (core/golden/i18n.json).

The Python dictionaries stay the source of truth; CI regenerates both outputs and fails on a diff.

Regenerate:  python tools/golden/generate_i18n.py
"""

import json
import string

from golden_common import OUT_DIR, ROOT, dump, fnv1a64

from i18n import DEFAULT_LANG, LANGUAGES, TRANSLATIONS, Joined, Msg, t, tm, transport_mode_name

LOCALES = ROOT / "core" / "src" / "i18n" / "locales"
FORMATTER = string.Formatter()


def fields_of(text: str) -> list[str]:
    return [name for _lit, name, _spec, _conv in FORMATTER.parse(text) if name is not None]


# Param descriptors: tagged values the TypeScript tests rebuild identically.
def build(desc):
    kind = desc["t"]
    if kind == "msg":
        return Msg(desc["key"], **{k: build(v) for k, v in desc.get("params", {}).items()})
    if kind == "joined":
        return Joined([build(v) for v in desc["items"]], desc["sep"])
    return desc["v"]  # str / int / float / bool / null


CHOICES = [
    {"t": "str", "v": "Ąbc Łódź"},
    {"t": "int", "v": 3},
    {"t": "float", "v": 2.5},
    {"t": "float", "v": 4.0},
    {"t": "msg", "key": "variant.walk"},
    {"t": "msg", "key": "variant.via", "params": {"via": {"t": "str", "v": "Poznań"}}},
    {
        "t": "joined",
        "items": [{"t": "msg", "key": "tmode.tram"}, {"t": "str", "v": "x"}],
        "sep": "/",
    },
    {"t": "null", "v": None},
    {"t": "bool", "v": True},
    {"t": "str", "v": ""},
]


def main() -> None:
    LOCALES.mkdir(parents=True, exist_ok=True)
    for lang, texts in TRANSLATIONS.items():
        (LOCALES / f"{lang}.json").write_text(
            json.dumps(texts, ensure_ascii=False, indent=0, sort_keys=False) + "\n",
            encoding="utf-8",
        )

    pl = TRANSLATIONS[DEFAULT_LANG]
    keys = list(pl)
    cases = []  # (key, offset) -> params descriptors by field name
    for i, key in enumerate(keys):
        names = sorted(set(fields_of(pl[key])))
        for offset in range(3):
            params = {n: CHOICES[(j + i + offset * 4) % len(CHOICES)] for j, n in enumerate(names)}
            cases.append({"key": key, "params": params})

    langs = list(LANGUAGES)
    hashes = []
    for c in cases:
        built = {k: build(v) for k, v in c["params"].items()}
        for lang in langs:
            hashes.append(fnv1a64(Msg(c["key"], **built).render(lang))[:12])

    readable = []
    for key in (
        "variant.rail_only",
        "skip.via_detour",
        "err.motis_stop_not_found",
        "other_day.label",
        "yes",
    ):
        for lang in langs:
            params = next(c["params"] for c in cases if c["key"] == key)
            readable.append(
                {"key": key, "lang": lang, "params": params,
                 "text": Msg(key, **{k: build(v) for k, v in params.items()}).render(lang)}
            )  # fmt: skip

    extra = {
        "t_missing_key": t("no.such.key", "en"),
        "t_missing_lang": t("yes", "xx"),
        "t_fallback_pl": {lang: t("yes", lang) for lang in langs},
        "t_no_fields_untouched": t("skip.part_other_day", "pl"),
        "tm_str": tm("plain"),
        "tm_msg": {lang: tm(Msg("variant.walk"), lang) for lang in langs},
        "transport_modes": {
            m: [str(transport_mode_name(m)), isinstance(transport_mode_name(m), Msg)]
            for m in (
                "RAIL",
                "REGIONAL_RAIL",
                "HIGHSPEED_RAIL",
                "SUBURBAN",
                "tram",
                "NEW_THING",
                "ODM",
            )
        },
        "msg_polish_text": str(
            Msg("variant.rail_only", modes=Joined(["a", "b"], "/"), transfers=2)
        ),
    }
    dump(OUT_DIR / "i18n.json", {"langs": langs, "keys": keys, "cases": cases, "hashes": hashes,
                                 "readable": readable, "extra": extra})  # fmt: skip


if __name__ == "__main__":
    main()
