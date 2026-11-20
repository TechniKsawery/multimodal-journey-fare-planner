"""Shared helpers for the golden-vector generators (Python oracle -> TypeScript tests)."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

OUT_DIR = ROOT / "core" / "golden"


def normalize(obj):
    """JSON-comparable form: enums -> value, integral floats -> int, dict keys sorted later."""
    if hasattr(obj, "value") and not isinstance(obj, (int, float, str)):
        return obj.value
    if isinstance(obj, str) and hasattr(obj, "value"):  # str-Enum
        return obj.value
    if isinstance(obj, dict):
        return {str(k): normalize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [normalize(v) for v in obj]
    if isinstance(obj, bool) or obj is None or isinstance(obj, str):
        return obj
    if isinstance(obj, float):
        return int(obj) if obj.is_integer() and abs(obj) < 1e15 else obj
    return obj


def canonical(obj) -> str:
    return json.dumps(normalize(obj), sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def fnv1a64(text: str) -> str:
    """64-bit FNV-1a over UTF-8 bytes (a fingerprint, not a security primitive)."""
    h = 0xCBF29CE484222325
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{h:016x}"


def dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            normalize(data), ensure_ascii=False, indent=None, separators=(",", ":"), sort_keys=True
        )
        + "\n",
        encoding="utf-8",
    )


def product_cases(axes: dict):
    """All combinations of the axes (ordered dict name -> values); the last axis varies fastest.
    The TypeScript tests enumerate in exactly this order."""
    import itertools

    names = list(axes)
    for combo in itertools.product(*(axes[n] for n in names)):
        yield dict(zip(names, combo, strict=True))


def outcome(fn, *args, **kwargs) -> dict:
    """{"ok": result} or {"error": message} — the shape the TypeScript tests reproduce."""
    try:
        return {"ok": fn(*args, **kwargs)}
    except ValueError as e:
        return {"error": str(e)}
    except Exception:  # noqa: BLE001 - anything else is just "not a ValueError" for the port
        return {"error": "<non-ValueError>"}
