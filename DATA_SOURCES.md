English | Polski: [wersja polska](DATA_SOURCES.pl.md)

# Data sources and licences

The source code and documentation are licensed under the
[Apache License 2.0](LICENSE). The project's own curated tables in `data/`
(fares, discounts, attractions, city cards, place aliases; numbers and rules
with a source URL and verification date, no copied third-party texts) are
licensed under [CC BY 4.0](data/LICENSE). The third-party data below is **not**
covered by the project licences; each source keeps its own terms. Large feeds
(GTFS, OSM) are downloaded by scripts, not stored in the repo.

Routing for the public web app is provided by the
[Transitous](https://transitous.org/sources/) API (see its source list and
attribution rules; map data © OpenStreetMap contributors, ODbL).

| Data | Source (URL) | Licence / terms | Fetched by |
|---|---|---|---|
| Polish rail GTFS | https://mkuran.pl/gtfs/polish_trains.zip | PKP PLK and Koleje Mazowieckie public-sector data terms (Polish), see https://mkuran.pl/gtfs/ (read 2026-11-12; linked terms not reviewed in full) | `scripts/fetch_data.py` |
| German long-distance GTFS (FV) | https://download.gtfs.de/germany/fv_free/latest.zip | CC BY 4.0 (gtfs.de) | `scripts/fetch_data.py` |
| German regional GTFS (RV) | https://download.gtfs.de/germany/rv_free/latest.zip | CC BY 4.0 (gtfs.de) | `scripts/fetch_data.py` |
| German local GTFS (NV) | https://download.gtfs.de/germany/nv_free/latest.zip | CC BY 4.0 (gtfs.de) | `scripts/fetch_data.py` |
| ZTM Lublin GTFS | https://mkuran.pl/gtfs/lublin.zip | CC0 | `scripts/fetch_data.py` |
| ZTM Warsaw GTFS | https://mkuran.pl/gtfs/warsaw.zip | ZTM terms + ODbL (see `motis/PL-CITIES-GTFS-NOTES.md`) | `scripts/fetch_data.py` |
| ZTP Krakow GTFS | https://gtfs.ztp.krakow.pl/ | page declares "Creative Commons (CC BY 4.0)" (read 2026-11-15, feed ver. 20261113); page gives no link to full terms and no attribution wording, so treat as not fully confirmed: attribute ZTP Krakow, do not redistribute until confirmed with ZTP; not downloaded by default | optional: `scripts/fetch_data_extended.py --krakow` |
| Hamburg / Munich / Cologne GTFS | see `motis/DE-FULL-CITY-GTFS-NOTES.md` | DL-DE-BY-2.0 / CC BY 4.0 / CC BY 4.0 | manual (notes) |
| OpenStreetMap extracts | https://download.geofabrik.de/ | ODbL, © OpenStreetMap contributors | `scripts/fetch_data.py` |
| Fares, discounts, attractions, city cards | per-record `zrodlo_url` + `data_weryfikacji` in `data/fares/*.json`, `data/attractions/*.json` | facts with source links; operators' terms apply; entries with `price_verified: false` are unverified estimates | maintained by hand |
| PKP Intercity "Super Promo International" prices | URL in `data/fares/pkp_spi_pl_de.json` (`_zrodlo_url`) | only numbers/rules are stored; full price-list text and PDF are not in the repo | maintained by hand |

Some research notes were produced with AI assistance and are marked "according to Gemini, not independently verified"
until checked against the primary source.

## Attribution required by the licences above

- OpenStreetMap: "© OpenStreetMap contributors" linked to https://www.openstreetmap.org/copyright (ODbL), wherever routing results or maps are shown publicly.
- Warsaw GTFS: ZTM Warszawa, Mikołaj Kuranowski, OpenStreetMap contributors (see `attributions.txt` in the feed).
- gtfs.de feeds: CC BY 4.0 (credit "gtfs.de"); HVV: DL-DE-BY-2.0; MVV, VRS: CC BY 4.0.
