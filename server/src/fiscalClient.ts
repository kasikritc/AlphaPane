import { getConfig } from "./config.js";
import type { StockPricePoint } from "./stockPrice.js";

type Query = Record<string, string | number | boolean | null | undefined>;

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 400;

export class FiscalClient {
  private readonly apiKey: string | null;
  private readonly baseUrl = "https://api.fiscal.ai";

  constructor(apiKey = getConfig().fiscalApiKey) {
    this.apiKey = apiKey;
  }

  async companyProfile(companyKey: string): Promise<Record<string, unknown>> {
    return this.request("/v2/company/profile", { companyKey });
  }

  async companyRatios(companyKey: string, periodType: string): Promise<Record<string, unknown>> {
    return this.request("/v1/company/ratios", {
      companyKey,
      periodType,
      currency: "USD",
      ratioId: [
        "market_data_share_price",
        "market_data_total_shares_outstanding",
        "calculated_market_cap",
        "calculated_tev",
        "ratio_ev_to_sales",
        "ratio_price_to_sales",
        "ratio_price_to_earnings",
        "ratio_ev_to_ebitda",
        "ratio_ev_to_fcf",
        "ratio_fcf_yield",
        "calculated_fcf",
        "ratio_fcf_margin",
        "ratio_ebitda_margin",
        "growth_revenue_1y",
        "growth_revenue_3y_cagr",
        "growth_revenue_5y_cagr"
      ].join(",")
    });
  }

  async standardizedFinancials(
    companyKey: string,
    statementType: "income-statement" | "balance-sheet" | "cash-flow-statement",
    periodType = "annual"
  ): Promise<Record<string, unknown>> {
    return this.request(`/v1/company/financials/${statementType}/standardized`, {
      companyKey,
      periodType,
      currency: "USD"
    });
  }

  async dailyRatio(companyKey: string, ratioId: string): Promise<Array<Record<string, unknown>>> {
    return this.request(`/v1/company/ratios/daily/${ratioId}`, { companyKey, currency: "USD" });
  }

  async stockPrices(companyKey: string): Promise<StockPricePoint[]> {
    return this.request("/v1/company/stock-prices", { companyKey });
  }

  private async request(path: string, query: Query): Promise<any> {
    if (!this.apiKey) {
      throw new Error("Missing API key. Add it to .env before refreshing data.");
    }
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Api-Key": this.apiKey
          }
        });
      } catch (error) {
        // Network failure or timeout abort. Retry a few times before giving up.
        clearTimeout(timer);
        lastError = error instanceof Error && error.name === "AbortError"
          ? new Error(`Data API request timed out after ${REQUEST_TIMEOUT_MS}ms: ${path}`)
          : error;
        if (attempt < MAX_ATTEMPTS) {
          await delay(backoffDelay(attempt));
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) return response.json();

      const body = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < MAX_ATTEMPTS) {
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        await delay(retryAfterMs ?? backoffDelay(attempt));
        continue;
      }
      throw new Error(`Data API ${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
    }

    // Unreachable in practice; the loop either returns or throws.
    throw lastError ?? new Error(`Data API request failed: ${path}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  // Exponential backoff with jitter: ~400ms, ~800ms, ~1600ms (+/- up to 200ms).
  const base = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 200);
}

function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(headerValue);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

