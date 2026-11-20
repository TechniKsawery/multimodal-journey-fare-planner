# core — TypeScript port of the pricing and routing logic

Pure functions only: no network calls, no secrets, no `eval`. The Python code in the repository
root (`fares/`, `routing/`, `attractions/`, …) stays as the **oracle**: it is the specification,
and this package must reproduce it.

## How the port is kept honest

1. `tools/golden/generate_*.py` runs the Python code on a wide grid of inputs and writes
   `core/golden/*.json` (full expected results for a readable subset, FNV-1a fingerprints of the
   full result for the large grids).
2. `npm test` runs the TypeScript port on the same inputs and requires an identical result:
   amount, currency, price type, the whole `breakdown` and the Polish `notes` text.
3. CI (`.github/workflows/core.yml`) regenerates the golden files from Python and fails if they
   differ from the committed ones, so the oracle and the vectors cannot drift apart.

Regenerate only when the Python logic or `data/**` changes on purpose:

```bash
python tools/golden/generate_fares.py   # also generate_misc.py, generate_scoring.py
```

## Conventions

- Field names stay `snake_case` (`pkp_ulga_kod`, `ride_duration_min`, …): they are the same keys
  as in Python, the golden vectors and the profile JSON saved in the browser.
- Data is imported from `data/**` (validated by `data/schemas` in the `Web` workflow). Nothing is
  copied. A price without a source and a verification date stays `price_verified: false`.
- `src/pyCompat.ts` reproduces Python behaviour that JavaScript does not have: `round(x, 2)`
  (half-to-even on the exact value), `f"{x:.0f}"`, `date.fromisoformat`, truthiness, key order.
- Untrusted input (localStorage, URL) goes through `parseDiscountProfile` before it reaches a
  calculator.
- Dependencies are pinned to exact versions; there are no runtime dependencies.

## Deliberate differences from Python

| Python | Port | Why |
|---|---|---|
| `fares/db.py` optional unofficial price lookup (`UNOFFICIAL_PRICES=1`) | not ported | no server; unofficial APIs are not called from the browser |
| `fares/flixbus.py` live FlixBus API when `travel_date` is set | always the PLN/km fallback (`price_verified: false`) | unofficial API, no CORS/ToS guarantee; golden vectors cover the fallback path |

## Status

See the checklist in `mobile-research/plan-pwa-apk-2026-11-15.md` (section 4). Ported so far:
`fares/` (all 22 carrier calculators, dispatch, discount profile validation, BahnCard suggestions,
age defaults, eligibility texts, foreigner warnings), `common/currency`, `routing/model`,
`routing/transfers`, `routing/scoring` (itinerary aggregation and all 11 recommendation categories).

Known, accepted difference: CPython >= 3.12 sums floats with compensation while JavaScript adds
left to right. The scoring golden scenarios skip the (synthetic) cases where this changes a
rounded total by one grosz, so the vectors do not depend on the Python minor version.
