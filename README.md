# AlphaPane

AlphaPane is a local-only investing research dashboard for the Fiscal.ai free-trial universe. It combines two scanner views in one TypeScript/Node web app.

Views:
- Reverse DCF: the GrowthLens-style priced-in 5-year revenue CAGR model.
- Historical Valuation: VI-Scanner-style valuation mean reversion, ranked by current P/E standard-deviation distance versus its own 5-year history.

Fiscal AI is the only data source in v1. The app does not use Yahoo Finance, FMP, or the old Python CLI.

## Setup

Run npm install, then copy .env.example to .env.

Add your Fiscal.ai API key to .env:

FISCAL_API_KEY=your_key_here

Optional local settings:

PORT=4317
DATABASE_PATH=./data/alphapane.db

## Run

Run npm run dev.

Open the Vite URL shown in the terminal. The API server defaults to http://localhost:4317.

## Refresh Data

AlphaPane seeds the 45 Fiscal.ai free-trial companies locally. Use the app buttons or npm scripts:

npm run refresh:financials
npm run refresh:prices

Refresh Financials populates company profiles, standardized financials, default assumptions, and reverse DCF outputs.

Refresh Market / refresh:prices updates latest market data, pulls Fiscal daily valuation ratios, recomputes reverse DCF outputs, and refreshes the Historical Valuation tab.

## Historical Valuation

The Historical Valuation tab ranks companies by P/E z-score ascending: the most negative score appears first, meaning current P/E is farthest below its own 5-year average. Invalid, negative, zero, missing, or insufficient P/E histories are shown as insufficient data.

V1 also displays secondary Fiscal multiple deviations when available:

- EV/Sales
- EV/EBITDA
- P/S
- FCF yield

Click a row to inspect the P/E band chart, current versus historical multiple stats, notes, and the Fiscal terminal link.

## Reverse DCF

The Reverse DCF tab solves for the 5-year revenue CAGR that makes modeled enterprise value equal current enterprise value:

Revenue -> normalized FCF margin -> 5-year FCF forecast -> terminal value -> discounted enterprise value

Fiscal does not provide analyst estimates here, so forward assumptions are mechanical defaults or local user overrides.

## Scripts

npm run typecheck
npm test
npm run build
