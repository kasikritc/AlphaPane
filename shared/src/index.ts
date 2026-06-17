export const TRIAL_COMPANIES = [
  "NASDAQ_MSFT",
  "NASDAQ_NVDA",
  "NASDAQ_AMZN",
  "NASDAQ_GOOG",
  "NASDAQ_TSLA",
  "NYSE_LLY",
  "NASDAQ_AVGO",
  "NYSE_V",
  "NYSE_MA",
  "NYSE_PG",
  "NASDAQ_NFLX",
  "NYSE_MCD",
  "NASDAQ_AMGN",
  "NYSE_CAT",
  "NYSE_UBER",
  "NYSE_MDT",
  "NYSE_DUK",
  "NASDAQ_EQIX",
  "NYSE_BRO",
  "NASDAQ_ZM",
  "NYSE_MKC",
  "NYSE_RYAN",
  "NYSE_MOH",
  "NYSE_CFG",
  "NYSE_JPM",
  "NASDAQ_ASML",
  "NYSE_SHEL",
  "NYSE_SONY",
  "NYSE_CB",
  "NASDAQ_MELI",
  "TSX_CSU",
  "TSX_ATD",
  "TSX_DOL",
  "TSX_CLS",
  "TSX_TFII",
  "XPAR_MC",
  "XSWX_NESN",
  "XPAR_RMS",
  "XETR_SIE",
  "XPAR_AIR",
  "XPAR_SAF",
  "XPAR_DSY",
  "XETR_RHM",
  "XLON_AT",
  "XLON_BME"
] as const;

export type CompanyKey = (typeof TRIAL_COMPANIES)[number];

export type Signal =
  | "priced-in growth looks low vs history"
  | "priced-in growth is near history"
  | "priced-in growth looks high vs history"
  | "insufficient data";

export interface CompanyRow {
  companyKey: string;
  ticker: string;
  exchange: string;
  name: string;
  sector: string | null;
  industry: string | null;
  reportingTemplate: string | null;
  terminalUrl: string | null;
  sharePrice: number | null;
  enterpriseValue: number | null;
  latestRevenue: number | null;
  evToRevenue: number | null;
  historicalRevenueCagr5y: number | null;
  normalizedFcfMargin: number | null;
  normalizedFcfMarginSource: string | null;
  discountRate: number | null;
  terminalGrowth: number | null;
  latestRevenueSource: string | null;
  historicalRevenueCagrSource: string | null;
  impliedRevenueCagr: number | null;
  cagrGap: number | null;
  signal: Signal;
  isFavorite: boolean;
  note: string;
  financialsUpdatedAt: string | null;
  pricesUpdatedAt: string | null;
  modelUpdatedAt: string | null;
  caution: string | null;
}


export type DashboardTab = "reverseDcf" | "historicalValuation";

export type ValuationMetricKey = "pe" | "evSales" | "evEbitda" | "priceSales" | "fcfYield";

export interface ValuationMetricStats {
  key: ValuationMetricKey;
  label: string;
  ratioId: string;
  current: number | null;
  mean: number | null;
  stdDev: number | null;
  zScore: number | null;
  percentileRank: number | null;
  observationCount: number;
  status: "ok" | "insufficient data";
}

export interface ValuationHistoryPoint {
  date: string;
  price: number | null;
  pe: number | null;
  bandPrices: Record<string, number | null>;
}

export interface ValuationRow {
  companyKey: string;
  ticker: string;
  exchange: string;
  name: string;
  sector: string | null;
  industry: string | null;
  terminalUrl: string | null;
  sharePrice: number | null;
  pe: ValuationMetricStats;
  evSales: ValuationMetricStats;
  evEbitda: ValuationMetricStats;
  priceSales: ValuationMetricStats;
  fcfYield: ValuationMetricStats;
  isFavorite: boolean;
  note: string;
  valuationUpdatedAt: string | null;
}

export interface ValuationDetail {
  row: ValuationRow;
  metrics: ValuationMetricStats[];
  peHistory: ValuationHistoryPoint[];
  peBandLevels: Record<string, number | null>;
}

export interface AssumptionSet {
  normalizedFcfMargin: number | null;
  discountRate: number | null;
  terminalGrowth: number | null;
}

export interface AssumptionSources {
  latestRevenue: string | null;
  normalizedFcfMargin: string | null;
  historicalRevenueCagr5y: string | null;
}

export interface ModelCell {
  label: string;
  kind: "actual" | "assumption" | "override" | "calculated" | "solved" | "blank";
  values: Array<number | string | null>;
  format: "currency" | "percent" | "multiple" | "number" | "text";
}

export interface CompanyDetail {
  row: CompanyRow;
  defaults: AssumptionSet;
  overrides: AssumptionSet;
  sources: AssumptionSources;
  gridColumns: string[];
  gridRows: ModelCell[];
  revenueHistory: Array<{ year: number; value: number; reportDate: string }>;
  fcfHistory: Array<{ year: number; value: number; margin: number | null; reportDate: string }>;
  sourceLinks: Array<{ label: string; url: string }>;
}

export interface RefreshRun {
  id: number;
  kind: "prices" | "financials";
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
}

export interface ColumnPreference {
  key: string;
  visible: boolean;
}
