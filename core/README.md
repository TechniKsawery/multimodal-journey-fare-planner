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
python tools/golden/generate_fares.py   # also generate_misc.py, generate_scoring.py, generate_attractions.py, generate_motis.py, generate_pricing.py, generate_i18n.py
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
| `routing/pricing.price_flight_leg` (Travelpayouts) | not ported: `priceLeg` throws for `LegMode.FLIGHT` | Travelpayouts is an affiliate/commercial API, excluded for Transitous's non-commercial terms (plan, decision 8.4); flights need their own source later |
| `leg.depart.date()` as the travel date | `toISOString().slice(0, 10)` (UTC date) | MOTIS times are UTC (`Z`), so the date is the same as in the oracle; note that a local departure just after midnight belongs to the previous UTC day in both |
| `fares/flixbus.py` live FlixBus API when `travel_date` is set | always the PLN/km fallback (`price_verified: false`) | unofficial API, no CORS/ToS guarantee; golden vectors cover the fallback path |

## Search: variants and recommendations (for the UI)

```ts
import { createTransitousClient, fastBudget } from "./src/routing/transitousClient";
import { makeRouteRequest } from "./src/routing/variants";
import { search } from "./src/routing/search";

const client = createTransitousClient();
const request = makeRouteRequest({ origin_stop_id: "51.2465,22.5684", destination_stop_id: "51.5049,7.1022",
  origin_label: "Lublin", destination_label: "Gelsenkirchen", date: "2026-12-01", discounts: profile });
const { built, skipped, recommendations, other_day } = await search(client, request, { mode: "fast", budget: fastBudget() });
```

`search` (`routing/search.ts`) builds the rail variants of one query (`routing/variants.ts`), prices every leg with `priceLeg`, rejects
physically impossible transfers, de-duplicates the same route found twice and picks the recommendations (`{}` when nothing feasible was found).
Variants that could not be built land in `skipped` with a reason (`Msg`); when the whole result is empty and the service only had connections on
other days, the nearest of them are in `other_day`. `variant_name` and the reasons are `Text` (a `Msg` to translate with `renderMsg`, or a string).

- **Query budget.** `"fast"` (default) makes ONE query (8 itineraries) — it fits `fastBudget()` (2). `"extended"` also tries the explicit
  via-hub variant (Poznań Główny, two more queries) and alternative stations, like the Python oracle; use `extendedBudget()` (12).
  A variant that runs out of budget is skipped with the reason `err.transitous_budget`; the main variants stay.
- **Time.** `date` + `departure_time` are Warsaw wall-clock time (`localIso` gives the ISO string with the offset, like Python's `fold=0`).
- **Errors.** Only `MotisError` (no connection, rejected request, budget) turns into a skipped variant; an abort or a bug propagates.
- **Not ported:** flight hubs (rail + flight + rail, flight + regional) — flights have no live prices here.
- Any object with `plan()` and `findStopId()` works as the client (a fake in tests); the oracle is checked by `test/variants.golden.test.ts`, which
  replays the requests the Python code recorded against a synthetic routing world (`tools/golden/generate_variants.py`).

## Deutschlandticket / BahnCard 100 (for the UI)

`DiscountProfile` has a `deutschlandticket: boolean` field (default `false`; `parseDiscountProfile` accepts it) next to `bahncard: "25" | "50" | "100" | null`.
A holder of either (BahnCard 100 includes the Deutschlandticket) pays 0 EUR extra for local/regional legs in Germany; `priceLeg` returns them as
`oficjalna_taryfa`, `price_verified: true`, with `breakdown.zrodlo_url` and `data_weryfikacji` (`routing/pricing.ts::deutschlandticketLeg`, scope in
`data/fares/deutschlandticket.json::zakres_posiadacza`). ICE/IC/EC, FlixBus/FlixTrain, bare `RAIL` legs and PL↔DE legs are NOT covered; see PRICING_GAPS.md.
The subscription price itself is `cena_miesieczna` there. Feed `priceLeg` the legs from `itineraryToLegs` (it needs `motis_mode`, `route_short_name` and coordinates in `leg.extra`).

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

## Place names and card suggestions (for the UI)

- `src/places/aliases.ts`: city names in the six UI languages from `data/places/aliases.json` (shape validated on load).
  `findCity(text)` finds a city by any spelling, `localQuery(text)` turns typed text into the local names the
  geocoder expects ("Cologne" -> "Köln"), `localizeName(name, lang)` / `placeText(name, lang)` show a geocoder
  name in the interface language with the local name next to it, `aliasNames()` feeds typo correction.
- `src/routing/cardSuggestions.ts`: `suggestBahncardForItinerary(itinerary, age, journeysPerYear, existingBahncard, referenceDate?)`
  sums the Flexpreis of the individual DB legs (cross-border PL<->DE legs are excluded, their BahnCard rules are
  already in the price) and returns the card suggestions; empty when there is no DB leg or the user's card is as good.
  Pass `referenceDate` (ISO date) to pin the day the card price is computed for (promotions have date windows).

Golden vectors: `core/golden/places.json` (about 1.6k spellings x 8 languages), `core/golden/card_suggestions.json` (5.6k itinerary x profile cases).

## i18n

`src/i18n/index.ts` renders `Msg` objects (`{key, params}`) in the six UI languages (`renderMsg`, `t`,
`tm`, `transportModeName`, `labelOr`). The dictionaries in `src/i18n/locales/*.json` are GENERATED from the
Python files by `tools/golden/generate_i18n.py` (CI fails on a diff), so the Python dictionaries stay the
source and a new key is added there. Parameters can be strings, numbers, booleans, `null`, nested `Msg`,
`joined([...], sep)` and `pyFloat(x)` (a Python float that must print as `5.0`; JS numbers cannot tell it
from `5`). Domain code returns `Text = string | Msg`; the UI calls `tm(text, lang)`.

## Status

See the checklist in `mobile-research/plan-pwa-apk-2026-11-15.md` (section 4). Ported so far:
`fares/` (all 22 carrier calculators, dispatch, discount profile validation, BahnCard suggestions,
age defaults, eligibility texts, foreigner warnings), `common/currency`, `routing/model`,
`routing/transfers`, `routing/scoring` (itinerary aggregation and all 11 recommendation categories),
`attractions/` (catalogue, city detection, working-note filter, localized texts, best price per profile, city-card calculator), `routing/motis_client` parsing + a Transitous client with a request budget, `fares/international_pkp` and `routing/pricing` (leg pricing: city/regional/long-distance tariffs by geography, PL/DE border detection, NRW, SPI range; flights excluded).

Known, accepted difference: CPython >= 3.12 sums floats with compensation while JavaScript adds
left to right. The scoring golden scenarios skip the (synthetic) cases where this changes a
rounded total by one grosz, so the vectors do not depend on the Python minor version.
