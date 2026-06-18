import { solveImpliedGrowth, evaluateDcf, terminalMetricValue, computeRealizedGrowth, cagr } from "./dcf.js";
import type { DcfSolveInputs, RevenuePoint, RealizedGrowthPoint } from "./dcf.js";

export { solveImpliedGrowth, evaluateDcf, terminalMetricValue, computeRealizedGrowth, cagr };
export type { DcfSolveInputs, RevenuePoint, RealizedGrowthPoint };


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

export type BasePeriod = 'ltm' | 'annual';

export interface FinancialBase {
  period: BasePeriod;
  label: string;
  revenue: number | null;
  fcf: number | null;
  fcfMargin: number | null;
  reportDate: string | null;
  source: string | null;
}

export type TerminalMethod = 'perpetuity' | 'exit-multiple';
export type ExitMetric = 'fcf' | 'ebitda' | 'revenue';

export interface AssumptionSet {
  basePeriod: BasePeriod | null;
  normalizedFcfMargin: number | null;
  discountRate: number | null;
  terminalGrowth: number | null;
  terminalMethod: TerminalMethod | null;
  exitMetric: ExitMetric | null;
  exitMultiple: number | null;
  normalizedEbitdaMargin: number | null;
}

export interface ExitMultipleStat {
  metric: ExitMetric;
  label: string;
  current: number | null;
  low: number | null;
  median: number | null;
  high: number | null;
  source: string | null;
}


export interface EvBridge {
  marketCap: number | null;
  cash: number | null;
  debt: number | null;
  leases: number | null;
  preferredStock: number | null;
  minorityInterest: number | null;
  netDebt: number | null;
  fiscalEnterpriseValue: number | null;
  rebuiltEnterpriseValue: number | null;
  difference: number | null;
  differencePercent: number | null;
  warning: string | null;
  asOfDate: string | null;
  source: string | null;
}

export interface AssumptionSources {
  latestRevenue: string | null;
  normalizedFcfMargin: string | null;
  historicalRevenueCagr5y: string | null;
  normalizedEbitdaMargin: string | null;
  exitMultiple: string | null;
}


export type SolveStatus = "ok" | "above-range" | "below-range" | "insufficient-data" | "invalid-assumptions";
export type BoundaryDirection = "requires-higher-growth" | "requires-lower-growth" | null;

export interface ModelDiagnostics {
  solveStatus: SolveStatus;
  boundaryDirection: BoundaryDirection;
  valueAtLowGrowth: number | null;
  valueAtHighGrowth: number | null;
  lowGrowthDelta: number | null;
  highGrowthDelta: number | null;
  terminalValueShare: number | null;
  explicitFcfShare: number | null;
  currentEvToRevenue: number | null;
  impliedY5Revenue: number | null;
  impliedY5Fcf: number | null;
  statusMessage: string | null;
}

export interface ModelCell {
  label: string;
  kind: "actual" | "assumption" | "override" | "calculated" | "solved" | "blank";
  values: Array<number | string | null>;
  format: "currency" | "percent" | "multiple" | "number" | "text";
}

export type SensitivityFormat = "percent" | "multiple";

export interface SensitivityTable {
  title: string;
  rowLabel: string;
  colLabel: string;
  rowFormat: SensitivityFormat;
  colFormat: SensitivityFormat;
  rowValues: number[];
  colValues: number[];
  cells: Array<Array<number | null>>;
}

export interface CompanyDetail {
  row: CompanyRow;
  defaults: AssumptionSet;
  overrides: AssumptionSet;
  sources: AssumptionSources;
  baseFinancials: {
    selected: BasePeriod | null;
    ltm: FinancialBase | null;
    annual: FinancialBase | null;
  };
  evBridge: EvBridge | null;
  diagnostics: ModelDiagnostics | null;
  exitMultipleStats: ExitMultipleStat[];
  sensitivity: SensitivityTable[];
  gridColumns: string[];
  gridRows: ModelCell[];
  revenueHistory: Array<{ year: number; value: number; reportDate: string }>;
  fcfHistory: Array<{ year: number; value: number; margin: number | null; reportDate: string }>;
  sourceLinks: Array<{ label: string; url: string }>;
}

export type RefreshKind = "prices" | "financials" | "all";
export type RefreshOrder = "given" | "oldest-first" | "newest-first";
export type RefreshStatus = "running" | "success" | "failed" | "partial";
export type RefreshItemStatus = "waiting" | "running" | "success" | "failed" | "skipped";
export type RefreshLogLevel = "info" | "success" | "warning" | "error";

export interface RefreshRun {
  id: number;
  kind: RefreshKind;
  status: RefreshStatus;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
  companyCount?: number;
  successCount?: number;
  failureCount?: number;
  order?: RefreshOrder | null;
}

export interface RefreshJobItem {
  id: number;
  refreshRunId: number;
  companyKey: string;
  ticker: string;
  name: string;
  sequence: number;
  status: RefreshItemStatus;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

export interface RefreshLogEntry {
  id: number;
  refreshRunId: number;
  itemId: number | null;
  companyKey: string | null;
  ticker: string | null;
  sequence: number;
  level: RefreshLogLevel;
  phase: string;
  operation: string;
  message: string;
  data: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: string;
}

export interface RefreshRunDetail {
  run: RefreshRun;
  items: RefreshJobItem[];
  logs: RefreshLogEntry[];
}

export interface ColumnPreference {
  key: string;
  visible: boolean;
}

export interface DailyEvPoint {
  date: string;
  enterpriseValue: number | null;
  sharePrice: number | null;
}


export interface ImpliedGrowthHistoryData {
  dailyEv: DailyEvPoint[];
  revenueTimeline: Array<{ reportDate: string; revenue: number }>;
  realizedGrowth: RealizedGrowthPoint[];
  maxHistoryYears: number;
  earliestDate: string | null;
  latestDate: string | null;
}
