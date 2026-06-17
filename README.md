# AlphaPane

AlphaPane is a local investing research dashboard for scanning the 45 Fiscal.ai free-trial companies by the 5-year revenue CAGR implied by current enterprise value.

## Setup

```bash
npm install
cp .env.example .env
```

Add your Fiscal.ai API key to `.env`:

```bash
FISCAL_API_KEY=your_key_here
```

## Run

```bash
npm run dev
```

Open the Vite URL shown in the terminal. The server defaults to `http://localhost:4317`.

## Data Refresh

The app seeds the 45-company universe locally. Use the dashboard buttons or CLI scripts to populate and update cached data:

```bash
npm run refresh:financials
npm run refresh:prices
```

`Refresh Financials` is the heavier workflow. `Refresh Prices` updates market-driven values from Fiscal ratios and recomputes the model outputs.

## Modeling

Primary model:

```text
Revenue -> FCF using normalized FCF margin -> 5-year FCF forecast -> terminal value -> discounted enterprise value
```

The app solves for the 5-year revenue CAGR that makes intrinsic EV equal current enterprise value. Fiscal does not provide analyst estimates, so forward assumptions are mechanical defaults or user overrides.

