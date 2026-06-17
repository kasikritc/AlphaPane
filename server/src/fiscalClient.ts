import { getConfig } from "./config.js";

type Query = Record<string, string | number | boolean | null | undefined>;

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
        "ratio_fcf_yield",
        "calculated_fcf",
        "ratio_fcf_margin",
        "growth_revenue_1y",
        "growth_revenue_3y_cagr",
        "growth_revenue_5y_cagr"
      ].join(",")
    });
  }

  async standardizedFinancials(
    companyKey: string,
    statementType: "income-statement" | "cash-flow-statement"
  ): Promise<Record<string, unknown>> {
    return this.request(`/v1/company/financials/${statementType}/standardized`, {
      companyKey,
      periodType: "annual",
      currency: "USD"
    });
  }

  async dailyRatio(companyKey: string, ratioId: string): Promise<Array<Record<string, unknown>>> {
    return this.request(`/v1/company/ratios/daily/${ratioId}`, { companyKey, currency: "USD" });
  }

  async stockPrices(companyKey: string): Promise<Array<{ date: string; open_price: number; close_price: number; volume: number }>> {
    return this.request("/v1/company/stock-prices", { companyKey });
  }

  private async request(path: string, query: Query): Promise<any> {
    if (!this.apiKey) {
      throw new Error("Missing FISCAL_API_KEY. Add it to .env before refreshing Fiscal data.");
    }
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Api-Key": this.apiKey
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Fiscal ${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
    }
    return response.json();
  }
}

