# mobile/ — Android app (Capacitor)

Thin native shell around the same bundle as the PWA (`web/`). Android only; iPhone users install the PWA.

```bash
cd mobile && npm ci --legacy-peer-deps
npm run sync     # builds ../web with VITE_BASE=./ and copies it into android/
npm run open     # opens Android Studio (needed to build/sign the APK)
```

Status: skeleton only (Android platform generated, no signing). The keystore never goes into the repo
(`*.keystore`/`*.jks` are git-ignored). Release APKs will be built by a GitHub workflow and attached to
GitHub Releases (plan step 8). To verify on a prototype: that the WebView origin (`https://localhost`)
is accepted by the Transitous CORS policy — open `transitous-proto.html` inside the app.
