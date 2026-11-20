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
python tools/golden/generate_fares.py   # also generate_misc.py, generate_scoring.py, generate_attractions.py, generate_motis.py
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
| `motis_client.plan_leg_candidates` asks MOTIS for `max(max_candidates, 3)` itineraries | fast mode asks for 8, extended mode for the oracle's 30 (`MAIN_QUERY_ITINERARIES`) | Transitous is a shared best-effort service (> 720 `/plan` per day needs agreement): fewer, cached queries by default |
| `fares/flixbus.py` live FlixBus API when `travel_date` is set | always the PLN/km fallback (`price_verified: false`) | unofficial API, no CORS/ToS guarantee; golden vectors cover the fallback path |

## Transitous client (for the UI)

`src/routing/transitousClient.ts` is a pure module: `fetch`, clock and sleep are injected, nothing
global is touched, so it runs in the PWA, a Web Worker, Capacitor and tests. Parsing lives in
`src/routing/motis.ts` (`itineraryToLegs`, `trackDistanceKm`, `decodePolyline`, `haversineKm`),
errors in `src/routing/errors.ts` (`MotisError` carries an i18n `Msg`).

```ts
import { createTransitousClient, fastBudget } from "core/src/routing/transitousClient";

const client = createTransitousClient();            // https://api.transitous.org; baseUrl is configurable
// typing in a place field (debounce 250-300 ms in the UI; results are cached 5 min, concurrent duplicates merged)
const suggestions = await client.geocodeSuggestions("Lublin", 5, abortSignal); // [{lat, lon, name, type?, areas?}]

// one user search = one budget
const budget = fastBudget();                         // 2 requests; extendedBudget() = 12
const options = await client.planLegCandidates(`${lat},${lon}`, `${lat2},${lon2}`, "2026-10-20T08:00:00Z", 3, { budget });
// -> Leg[][] (fastest first). Throws MotisError (msg = {key, params}) or BudgetExceededError.
```

Rules the client enforces: every network request (retries included) costs one budget unit and a
spent budget throws `BudgetExceededError` before anything is sent; cache hits and merged duplicates
are free; 429/5xx are retried twice with backoff (`Retry-After` honoured, capped at 30 s), 400 becomes
`err.motis_rejected`; 30 s timeout; the caller's `AbortSignal` cancels without retry; only
`https://` base URLs (plain `http://` for localhost only, no credentials in the URL); requests are
sent with `credentials: "omit"` and an `Accept` header only (a browser does not allow a custom
`User-Agent`; Capacitor may send one natively). Geocoding never spends a plan budget.
New i18n key to add with the i18n port: `err.transitous_budget` (`{limit}`).

Tests: `test/motis.golden.test.ts` (parser vs the Python oracle on the synthetic MOTIS fixture and
generated itineraries; floats compared with a tolerance) and `test/transitousClient.test.ts`
(fake `fetch`). Transitous itself is not reachable from the build environment, so there are no
recorded live responses yet: the first recording (4-5 reference routes) should be done from a
machine with access and added as fixtures.

## Status

See the checklist in `mobile-research/plan-pwa-apk-2026-11-15.md` (section 4). Ported so far:
`fares/` (all 22 carrier calculators, dispatch, discount profile validation, BahnCard suggestions,
age defaults, eligibility texts, foreigner warnings), `common/currency`, `routing/model`,
`routing/transfers`, `routing/scoring` (itinerary aggregation and all 11 recommendation categories),
`attractions/` (catalogue, city detection, working-note filter, localized texts, best price per profile, city-card calculator), `routing/motis_client` parsing + a Transitous client with a request budget (new).

Known, accepted difference: CPython >= 3.12 sums floats with compensation while JavaScript adds
left to right. The scoring golden scenarios skip the (synthetic) cases where this changes a
rounded total by one grosz, so the vectors do not depend on the Python minor version.
