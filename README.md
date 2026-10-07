# Trading Journal

A fast, private trading journal that runs entirely in your browser. No backend, no accounts, no dependencies.

**Logs:** entry signal, stop loss, profit target, trailing stop, emotions (entry / holding losers / holding winners / exit), plan adherence (1–5), what you could have done better, what you learned.

**Calendar view:** monthly P&L heatmap (green/red days, trade counts, best/worst day, win rate); click a day to see its trades or log a new one.

**Computes:** win rate, average win, average loss, win/loss ratio, expectancy, profit factor, average R, equity curve, P&L by plan adherence and by emotion.

Data lives in `localStorage` (this browser only). Use the **Data** tab to export/import JSON or export CSV.

## Run
Open `index.html`, or serve the folder (`python -m http.server`). Works on any static host (GitHub Pages, Netlify, ...).

## Cloud sync (Firebase)
Sign in (header button) to keep one journal across phone, laptop and the APK. Uses Firebase Auth (email/password) + Cloud Firestore with an offline cache, so logging works without signal and syncs later. Signed out, data stays in this browser only.

One-time Firebase setup: Authentication → Email/Password → Enable; Firestore Database → Create; then paste `firestore.rules` into Firestore → Rules → Publish. Each user can only read/write `users/{their uid}/trades`.

The Firebase web config in `src/cloud.js` is a public identifier, not a secret; the rules are what protect the data.

## Develop
```
npm install
npm run bundle      # rebuild cloud.bundle.js after editing src/cloud.js (committed so GitHub Pages needs no build)
npm run serve       # http://localhost:8080
npm run apk         # builds TradingJournal-debug.apk (needs JDK 21 + Android SDK, same as emcinemara)
```

## Hosting (Firebase Hosting, free, works with a private repo)
```
npx firebase-tools login      # once, opens your browser
npm run deploy                # bundles, builds www/, deploys site + Firestore rules
```
Live at https://deathnote-5a3b5.web.app
