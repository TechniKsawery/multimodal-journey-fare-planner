# Beta on GitHub Pages

URL after the first deploy: https://techniksawery.github.io/multimodal-journey-fare-planner/

- One-time setup (repo owner): **Settings -> Pages -> Build and deployment -> Source: GitHub Actions**.
- Deploy: `.github/workflows/pages.yml` on every push to `main` touching `web/` or `data/` (or run it manually from the Actions tab).
- Pages: `index.html` (live search: Transitous routes + prices from `core/`) and `transitous-proto.html` (live routing via Transitous, no prices).
- Security: actions pinned to commit SHAs, `contents: read` by default (deploy job adds `pages: write`, `id-token: write`), no secrets or tokens in the build (the workflow scans `dist/` and fails on matches; external hosts are checked against `web/allowed-hosts.json` by `npm run check-hosts`, in the Web CI on every PR and again before deploy), CSP via `<meta>` (self + `api.transitous.org` only), no third-party scripts or fonts.
- Service worker caches only same-origin static files; cross-origin requests (Transitous) are never cached.
