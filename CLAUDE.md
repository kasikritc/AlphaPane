# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AlphaPane is a local-only investing research dashboard for the ~45 Fiscal.ai free-trial companies. It presents two scanner views over the same company universe:

- **Reverse DCF** — solves for the 5-year revenue CAGR that makes a modeled enterprise value equal the current EV, then compares it to historical growth ("priced-in growth").
- **Historical Valuation** — ranks companies by P/E z-score against their own trailing 5-year multiple history (mean reversion), plus secondary multiples (EV/Sales, EV/EBITDA, P/S, FCF yield).

Fiscal.ai (`https://api.fiscal.ai`) is the **only** data source. There is no Yahoo Finance / FMP / Python CLI — those belonged to older iterations and must not be reintroduced.

## Commands

All commands run from the repo root (npm workspaces).

```bash
npm run dev               # run server (tsx watch, :4317) + client (vite, :5178) together
npm test                  # vitest run, server workspace only
npm run typecheck         # builds shared, then typechecks server + client
npm run build             # build shared -> server -> client (order matters)

# Refresh data (writes to data/alphapane.db; requires FISCAL_API_KEY)
npm run refresh:financials   # profiles, standardized financials, DCF assumptions/outputs
npm run refresh:prices       # market snapshot + valuation snapshots (Historical Valuation tab)
npm run backfill:fallbacks   # recompute fallbacks from cached data, no API calls
```

Run a single test (from `server/`): `npx vitest run src/math.test.ts` or filter by name with `npx vitest run -t "<pattern>"`.

Setup: `npm install`, then copy `.env.example` to `.env` and set `FISCAL_API_KEY`. Optional: `PORT` (default 4317), `DATABASE_PATH` (default `./data/alphapane.db`).

## Architecture

Three npm workspaces under a `"type": "module"` root. **`@alphapane/shared` must be built before server/client** because they import it via `file:` and resolve it from `dist/` — this is why every top-level script rebuilds shared first.

- **`shared/`** — the cross-cutting type contract (`CompanyRow`, `ValuationRow`, `ModelCell`, `ValuationMetricStats`, etc.) and `TRIAL_COMPANIES`, the canonical list of company keys (`EXCHANGE_TICKER`, e.g. `NASDAQ_MSFT`). This list drives seeding and every refresh loop.
- **`server/`** — Express API + SQLite + all financial computation.
- **`client/`** — single-file React 19 SPA (`client/src/App.tsx`, ~590 lines) that renders both tabs, detail panels, and refresh controls. Vite dev server proxies `/api` to `:4317`.

### Server layout (`server/src/`)

- `index.ts` — boots the API. `cli.ts` — same DB/refresh modules behind the `refresh:*` / `backfill:fallbacks` subcommands.
- `db.ts` — opens SQLite via **`node:sqlite` (`DatabaseSync`)** — a native Node built-in, no external driver. Uses WAL. `migrate()` is idempotent (`CREATE TABLE IF NOT EXISTS` + `addColumnIfMissing` for additive migrations — follow that pattern, there is no migration framework). `seedTrialCompanies()` inserts the universe with hard-coded display names on every boot.
- `fiscalClient.ts` — thin typed wrapper over the Fiscal.ai REST endpoints; auth via `X-Api-Key`. The set of `ratioId`s requested in `companyRatios` is the source of truth for which metrics exist downstream.
- `refresh.ts` — the two ingestion pipelines. **Important distinction:** `refreshFinancials` populates profiles/financials/DCF only; `refreshPrices` is the only path that calls `refreshValuationSnapshot` and therefore the only way to populate the Historical Valuation tab. Both call `recomputeModels` at the end. Contains the layered fallback logic (`chooseNormalizedFcfMargin`, `chooseExitRevenueMultiple`, `inferLatestRevenue`) that picks a default and records a human-readable source string for each.
- `valuation.ts` — pure functions for the Historical Valuation tab: z-scores, percentile ranks, and P/E σ-bands over a trailing window. `MIN_VALUATION_OBSERVATIONS = 252` (one trading year) is the cutoff below which a metric is "insufficient data". `lowerIsCheaper` flips the sign so a more negative z-score always means "cheaper vs history".
- `math.ts` — pure reverse-DCF engine. `buildModel` validates inputs, then `solveGrowth` bisects (-50%..+100%) for the implied CAGR under both a Gordon terminal value and an exit-multiple terminal value, and emits the spreadsheet `gridRows`. Pure and unit-tested — keep it free of DB/IO.
- `repository.ts` — all SQL and the mapping between DB rows and shared types. Persisted snapshot tables are the cache; **derived outputs are recomputed, not fetched.** Key behaviors:
  - User `assumption_overrides` are layered over computed defaults via `COALESCE(override, default)` in `recomputeModels`; saving an assumption recomputes only that company.
  - Valuation/model results are stored as JSON blobs (`*_json` columns) and parsed back through `parseJson`.
  - `app.ts` is a flat set of `/api/...` routes; mutations (`PATCH` state/assumptions, `POST` refresh) return the freshly recomputed rows so the client never re-derives anything.

### Data flow

`Fiscal API → refresh.ts (fetch + choose defaults) → repository upserts (snapshot tables) → recomputeModels / buildValuationSnapshot → derived tables → app.ts GET → React`. The DB is a cache of API responses plus computed outputs; user edits (favorites, notes, assumption overrides) are the only authoritative local state.

## Conventions

- Computation modules (`math.ts`, `valuation.ts`) are pure and the only place with meaningful test coverage — put new financial logic there and test it, rather than in `refresh.ts`/`repository.ts`.
- Every nullable numeric flows through the local `numberOrNull` / `isPositive` guards; financial fields are `number | null` end-to-end and the UI renders `null` as "insufficient data" rather than 0.
- When a default is chosen from a fallback chain, also set its `*Source` string — the UI surfaces provenance to the user.


## Engineering practice to follow

When working in this git-tracked environment, please commit early and often. A good practice is to make a commit whenever you finish a small, logical piece of work, such as a bug fix, a small feature, or a refactor.

Try to avoid waiting until the end and committing everything in one large commit. Smaller commits make your work easier to review, easier to debug, and easier to roll back if needed.

A good rule of thumb: each commit should represent one clear change and have a meaningful commit message describing what changed.


</content>
</invoke>
