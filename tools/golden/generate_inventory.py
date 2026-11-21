"""Inventory of what the TypeScript port must keep in step with the Python oracle.

Writes core/golden/inventory.json: every Carrier (name -> value) and every JSON data file under data/
(except schemas). core/test/inventory.test.ts fails when a carrier is missing in TypeScript or a data file
is neither used by core/src nor on the explicit, reasoned allowlist, so new data cannot silently skip the port.

Regenerate:  python tools/golden/generate_inventory.py
"""

from golden_common import OUT_DIR, ROOT, dump

from fares.model import Carrier


def main() -> None:
    files = sorted(
        p.relative_to(ROOT).as_posix()
        for p in (ROOT / "data").rglob("*.json")
        if "schemas" not in p.parts
    )
    dump(
        OUT_DIR / "inventory.json",
        {"carriers": {c.name: c.value for c in Carrier}, "data_files": files},
    )


if __name__ == "__main__":
    main()
