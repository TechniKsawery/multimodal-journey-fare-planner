# data/ — curated data tables

Single home of all project data (licence: [CC BY 4.0](LICENSE)). Used by the Python reference
implementation today and by the TypeScript `core/` after the port.

| Directory | Content |
|---|---|
| `fares/` | fare tables per carrier / city (numbers + rules, each with source URL and verification date) |
| `attractions/` | attractions, city cards, translations |
| `flights/` | cabin/checked baggage, **placeholder** extras (not a fact) |
| `routing/` | airports |
| `places/` | place-name aliases (6 languages) |
| `schemas/` | JSON Schemas; checked in CI by `npm run validate-data` (in `web/`) |

Rule: never guess a price. A verified value needs a source URL + date, otherwise `price_verified: false`.
Large downloaded feeds (`data/gtfs`, `data/osm`) are git-ignored.
