# AlphaPane

AlphaPane is an equity research dashboard that surfaces mispricing across a curated company universe. It turns company fundamentals, market ratios, and price history into a local research workspace for finding where the market's implied expectations look stretched, stale, or unusually conservative.

The app is built for developers who want the research logic to stay inspectable. Data ingestion, model recomputation, persistence, and UI rendering are split into small TypeScript workspaces, and the core valuation math lives in pure functions with focused tests.

## What AlphaPane Does

AlphaPane gives you two scanner views over the same company universe:

- **Reverse DCF**: solves for the 5-year revenue CAGR implied by today's enterprise value, then compares that priced-in growth to the company's own historical growth.
- **Historical Valuation**: ranks companies by valuation mean reversion, starting with current P/E z-score versus each company's trailing 5-year history and adding secondary multiple checks such as EV/Sales, EV/EBITDA, P/S, and FCF yield.

The dashboard is local-first. Your machine owns the SQLite cache, favorites, notes, column preferences, and company-specific model overrides. External data is pulled only during refresh operations.

## Why This Exists

Equity research often starts with a broad question: where might expectations be wrong? AlphaPane is designed for that first pass. Refresh the universe, sort by priced-in growth or valuation dislocation, then drill into the rows where the numbers suggest a gap between market price and business trajectory.

It is not a trading bot, portfolio manager, or investment recommendation engine. It is a research surface that makes the model, assumptions, fallback logic, and data freshness visible enough for developers and analysts to inspect.

## What You Can Do

- Scan a curated company universe from a browser UI.
- Compare current market expectations against historical revenue growth.
- Inspect reverse DCF model grids, diagnostics, and sensitivity tables.
- Switch terminal value logic between perpetuity growth and exit multiple assumptions.
- Rank companies by historical valuation z-scores and percentile ranks.
- View P/E band history and secondary multiple deviations.
- Save favorites, notes, column visibility, and company-specific model overrides locally.
- Refresh financials and market data from either the app or npm scripts.

## Tech Stack

- **Client**: React 19, Vite, TypeScript, lucide-react.
- **Server**: Node.js, Express 5, TypeScript, `node:sqlite`.
- **Shared package**: TypeScript types, curated company universe, and pure DCF helpers.
- **Tests**: Vitest for server-side math, valuation, and refresh behavior.
- **Persistence**: Local SQLite cache plus local user state.

## Requirements

- Node.js 22 or newer. The server uses the built-in `node:sqlite` API.
- npm.
- A data provider API key for refresh operations.

## Quick Start

```bash
npm install
cp .env.example .env
```

Fill in the required provider key shown in `.env.example`.

Optional local settings:

```bash
PORT=4317
DATABASE_PATH=./data/alphapane.db
```

Start the full development app:

```bash
npm run dev
```

Then open the Vite app at `http://localhost:5178`. The client proxies `/api` requests to the Express server at `http://localhost:4317`.

On first run, the database is created automatically and seeded with the curated company universe. To populate live data, click **Refresh data** in the app or run the refresh scripts below.

## Data Refresh Commands

```bash
npm run refresh:financials
npm run refresh:prices
npm run backfill:fallbacks
```

`refresh:financials` fetches company profiles, standardized financial statements, default DCF assumptions, source links, and reverse DCF outputs.

`refresh:prices` fetches current market snapshots, daily valuation ratios, stock prices, valuation z-scores, P/E band data, daily enterprise value history, and then recomputes reverse DCF outputs.

`backfill:fallbacks` recomputes cached fallback values from local data without calling the external data provider.

For a fresh local cache, run financials first and prices second:

```bash
npm run refresh:financials
npm run refresh:prices
```

## Everyday Commands

```bash
npm run dev        # Run server and client together
npm test           # Run server Vitest suite
npm run typecheck  # Build shared, then typecheck server and client
npm run build      # Build shared, server, and client in dependency order
```

The top-level scripts are the safest entry points because `@alphapane/shared` must be built before the server or client import it from `dist/`.

## Repository Map

```text
.
├── client/   # React SPA, Vite dev server, dashboard UI
├── server/   # Express API, SQLite cache, ingestion, model recomputation
├── shared/   # Shared TypeScript contracts, company universe, pure DCF helpers
├── data/     # Local SQLite database files, ignored by git
└── README.md
```

Important files:

- `shared/src/index.ts`: shared row/detail types and the canonical `TRIAL_COMPANIES` list.
- `shared/src/dcf.ts`: pure reverse DCF evaluation and implied-growth solving helpers.
- `server/src/index.ts`: Express server bootstrap.
- `server/src/app.ts`: flat `/api/...` route definitions.
- `server/src/db.ts`: SQLite schema, additive migrations, and company universe seeding.
- `server/src/refresh.ts`: financial and market ingestion pipelines.
- `server/src/repository.ts`: SQL persistence, shared type mapping, local state, and recomputation.
- `server/src/valuation.ts`: historical valuation stats, z-scores, percentile ranks, and P/E bands.
- `server/src/math.ts`: reverse DCF model construction and solver.
- `client/src/App.tsx`: the dashboard UI, tabs, tables, detail panels, refresh controls, and local preferences.

## Architecture

AlphaPane has three npm workspaces:

1. `@alphapane/shared` owns the cross-package contract: company rows, valuation rows, detail payloads, model cells, refresh metadata, and the curated company universe.
2. `@alphapane/server` owns all I/O and computation: data provider requests, SQLite cache writes, model recomputation, and HTTP routes.
3. `@alphapane/client` owns presentation: scanner tables, sorting, filtering, column preferences, detail panels, assumption editing, and refresh controls.

The data flow is intentionally linear:

```text
External data provider
  -> server/src/refresh.ts
  -> SQLite snapshot tables
  -> recomputeModels / buildValuationSnapshot
  -> Express /api routes
  -> React dashboard
```

The database is not a source of truth for external market data. It is a local cache of fetched data plus user-owned state such as notes, favorites, column preferences, and assumption overrides.

## API Surface

The client uses these local routes:

```text
GET   /api/health
GET   /api/companies
GET   /api/companies/:companyKey
GET   /api/companies/:companyKey/implied-growth-history
GET   /api/valuation/companies
GET   /api/valuation/companies/:companyKey
GET   /api/refresh-runs
PATCH /api/companies/:companyKey/state
PATCH /api/companies/:companyKey/assumptions
PATCH /api/preferences/columns
POST  /api/refresh/financials
POST  /api/refresh/prices
```

Mutating routes return freshly recomputed rows or details so the client does not duplicate financial logic.

## Local Data and Git Hygiene

Generated local files are ignored by git:

- `.env`
- `data/*.db`, `data/*.db-shm`, `data/*.db-wal`
- `dist/`
- `coverage/`
- `dev.log`

If you need to reset your local cache, stop the dev server and remove the ignored database files under `data/`, then run the refresh commands again.

## Development Notes

- Keep financial computation in pure modules such as `server/src/math.ts` and `server/src/valuation.ts`, then cover it with focused Vitest tests.
- Keep `server/src/refresh.ts` focused on ingestion and default selection, and include human-readable `*Source` strings when a fallback value is chosen.
- Keep `server/src/repository.ts` as the boundary for SQL reads/writes and shared type mapping.
- Use additive SQLite migrations in `server/src/db.ts`; there is no separate migration framework.
- Treat `number | null` as the normal shape for financial values. The UI should show missing or invalid data as insufficient data, not as zero.
- Keep provider-specific logic behind the server data client so model code and UI code stay provider-agnostic.

## Validation Before a Pull Request

```bash
npm run typecheck
npm test
npm run build
```

Small, focused commits are preferred. A good commit usually changes one behavior, one refactor, or one documentation unit at a time.
