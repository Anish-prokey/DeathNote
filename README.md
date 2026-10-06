# Trading Journal

A fast, private trading journal that runs entirely in your browser. No backend, no accounts, no dependencies.

**Logs:** entry signal, stop loss, profit target, trailing stop, emotions (entry / holding losers / holding winners / exit), plan adherence (1–5), what you could have done better, what you learned.

**Computes:** win rate, average win, average loss, win/loss ratio, expectancy, profit factor, average R, equity curve, P&L by plan adherence and by emotion.

Data lives in `localStorage` (this browser only). Use the **Data** tab to export/import JSON or export CSV.

## Run
Open `index.html`, or serve the folder (`python -m http.server`). Works on any static host (GitHub Pages, Netlify, ...).
