# Regulations.gov Comment Browser

Explore and analyze public-comment data from U.S. federal rule-makings directly in your browser — no backend required.

---

## ✨ What is this?
A single-page React application that ships a compressed SQLite database (compiled to WASM) together with the JavaScript bundle.  Open `dist/index.html` in any modern browser and you can:

* Browse an AI-generated **theme hierarchy** of topics
* Read **narrative summaries** that explain consensus, debate, and stakeholder dynamics
* Dive into **stance heat-maps** showing how different stakeholder groups align
* Inspect individual **perspectives** & jump to full comments

All of this works **offline** once the bundle is built.

<p align="center">
  <em>Screenshot TODO</em>
</p>

---

## 🛠️ Developer guide

### Requirements
* [Bun](https://bun.sh/) ≥ 1.1 (provides the runtime, package manager, and bundler)
* A recent Node / npm if you prefer, but Bun alone is sufficient

### Install deps
```bash
bun install
```

### Develop in watch-mode
```bash
bun run dev        # serves dist/ on http://localhost:8080 & rebuilds on change
```
(The script uses `bun build --watch` plus a tiny static server.)

### Build for production
```bash
bun run build      # bundles TS/JS, minifies, runs Tailwind, copies DB → dist/
```
The output lives in `browser/dist/`.

### Project structure
```
/                            project root
├─ browser/                  React SPA
│  ├─ src/
│  │  ├─ pages/              route components (Home, ThemeDetail, StanceDetail…)
│  │  ├─ components/         reusable UI (StancePivotMatrix, ThemeNarrative…)
│  │  ├─ database/           sql.js provider + typed query helpers
│  │  ├─ utils/              perf logging, misc helpers
│  │  └─ styles/             Tailwind entry
│  ├─ dist/                  production bundle (generated)
│  └─ tailwind.config.js
├─ database-schema.sql       full SQLite schema (executes in browser & Node)
├─ theme-analysis.ts         CLI that calls Gemini to generate narrative/stances
└─ README.md                 this file
```

### Performance tracing
We ship a lightweight helper in `utils/perf.ts` that logs timings to the browser console.  Wrap any hot path with:
```ts
import { measure } from "../utils/perf";
const data = measure("expensive-query", () => db.exec(...));
```
Marks like `theme-detail-total` and `StancePivotMatrix build` are already in place.

### Regenerating the database / AI analysis
1. **Collect comments** and insert into `output/abstractions.db` using your own ETL.
2. Run the analysis script (requires a valid `GEMINI_API_KEY` env var):
   ```bash
   bun run theme-analysis           # processes all themes with ≥10 perspectives
   bun run theme-analysis A.B C.D   # or pass specific theme codes
   ```
   * The script skips themes that already have both a narrative and ≥3 stances stored.
   * Results are persisted to the same SQLite DB (`theme_narratives`, `theme_stances`, etc.).
3. Re-build the browser bundle so the updated DB is copied into `dist/`.

### Linting / type-checking
We rely on TypeScript's compiler:
```bash
bunx tsc --noEmit
```
(But CI or you can run it manually; the main dev workflow does not auto-run this each rebuild.)

### Contributing
Pull requests & issues are welcome!  Please:
* Follow the existing coding style (Prettier defaults).
* Keep the app self-contained without introducing runtime back-end dependencies.
* Include screenshots or perf numbers when altering UI or heavy queries.

### License
MIT © 2024 – community contributions gladly accepted. 