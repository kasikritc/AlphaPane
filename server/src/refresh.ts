import type { DatabaseSync } from "node:sqlite";
import type { BasePeriod, EvBridge, ExitMetric, ExitMultipleStat, FinancialBase, RefreshKind, RefreshLogLevel, RefreshOrder, RefreshStatus } from "@alphapane/shared";
import { TRIAL_COMPANIES } from "@alphapane/shared";
import { FiscalClient } from "./fiscalClient.js";
import { cagr, defaultDiscountRate, median, normalizeTerminalGrowth } from "./math.js";
import {
  appendRefreshLog,
  createRefreshRunItem,
  createRefreshRun,
  finishRefreshRun,
  getCompanyRows,
  recomputeModels,
  updateRefreshRunItem,
  upsertCompanyProfile,
  upsertDailyEvHistory,
  upsertFinancialSnapshot,
  upsertMarketSnapshot,
  upsertValuationSnapshot
} from "./repository.js";
import { stockClosePrice } from "./stockPrice.js";
import { buildValuationSnapshot, VALUATION_RATIOS } from "./valuation.js";

interface StandardizedRow {
  reportDate: string;
  calendarYear: number;
  periodType?: string;
  metricsValues: Record<string, any>;
}

interface RefreshBatchOptions {
  companyKeys?: string[];
  kind: RefreshKind;
  order?: RefreshOrder;
  continueOnError?: boolean;
}

interface RefreshLogger {
  runId: number;
  itemId: number | null;
  companyKey: string | null;
  log: (input: {
    level: RefreshLogLevel;
    phase: string;
    operation: string;
    message: string;
    data?: Record<string, unknown> | null;
    durationMs?: number | null;
  }) => void;
}

export async function refreshPrices(db: DatabaseSync, client = new FiscalClient()): Promise<void> {
  const result = await refreshBatch(db, { kind: "prices", companyKeys: [...TRIAL_COMPANIES], order: "given", continueOnError: false }, client);
  if (result.status === "failed") throw new Error(result.message ?? "Price refresh failed.");
}

export async function refreshFinancials(db: DatabaseSync, client = new FiscalClient()): Promise<void> {
  const result = await refreshBatch(db, { kind: "financials", companyKeys: [...TRIAL_COMPANIES], order: "given", continueOnError: false }, client);
  if (result.status === "failed") throw new Error(result.message ?? "Financial refresh failed.");
}

export async function refreshBatch(db: DatabaseSync, options: RefreshBatchOptions, client = new FiscalClient()): Promise<{ runId: number; status: RefreshStatus; message: string }> {
  const order = options.order ?? "given";
  const companyKeys = resolveRefreshCompanyKeys(db, options.companyKeys, options.kind, order);
  const runId = createRefreshRun(db, options.kind, { companyCount: companyKeys.length, order });
  const runLogger = makeRefreshLogger(db, runId, null, null);
  const itemIds = companyKeys.map((companyKey, index) => createRefreshRunItem(db, runId, companyKey, index + 1));
  const failures: Array<{ companyKey: string; message: string }> = [];

  runLogger.log({
    level: "info",
    phase: "run",
    operation: "refreshBatch",
    message: `Starting ${options.kind} refresh for ${companyKeys.length} companies.`,
    data: { kind: options.kind, order, companyKeys, continueOnError: options.continueOnError ?? true }
  });

  for (const [index, companyKey] of companyKeys.entries()) {
    const itemId = itemIds[index];
    const logger = makeRefreshLogger(db, runId, itemId, companyKey);
    updateRefreshRunItem(db, itemId, "running");
    try {
      logger.log({ level: "info", phase: "company", operation: "begin", message: `Refreshing ${companyKey}.`, data: { kind: options.kind, ordinal: index + 1, total: companyKeys.length } });
      if (options.kind === "prices" || options.kind === "all") await refreshCompanyPrices(db, companyKey, client, logger);
      if (options.kind === "financials" || options.kind === "all") await refreshCompanyFinancials(db, companyKey, client, logger);
      recomputeModels(db, [companyKey]);
      updateRefreshRunItem(db, itemId, "success", "Refresh complete.");
      logger.log({ level: "success", phase: "company", operation: "finish", message: `Completed ${companyKey}.`, data: { kind: options.kind } });
    } catch (error) {
      const message = errorMessage(error);
      failures.push({ companyKey, message });
      updateRefreshRunItem(db, itemId, "failed", message);
      logger.log({ level: "error", phase: "company", operation: "finish", message: `Failed ${companyKey}: ${message}`, data: errorDiagnostic(error) });
      if (options.continueOnError === false) break;
    }
  }

  const successCount = companyKeys.length - failures.length;
  const status: RefreshStatus = failures.length === 0 ? "success" : successCount > 0 ? "partial" : "failed";
  const message = failures.length === 0
    ? `Updated ${options.kind} data for ${companyKeys.length} companies.`
    : `Updated ${successCount} of ${companyKeys.length} companies. Failed: ${failures.map((failure) => failure.companyKey).join(", ")}.`;
  runLogger.log({ level: status === "success" ? "success" : "error", phase: "run", operation: "refreshBatch", message, data: { failures } });
  finishRefreshRun(db, runId, status, message);
  return { runId, status, message };
}

async function refreshCompanyPrices(db: DatabaseSync, companyKey: string, client: FiscalClient, logger: RefreshLogger): Promise<void> {
  // Fetch every independent series concurrently. stockPrices is fetched once and shared between
  // the valuation snapshot and the daily-EV history (previously it was downloaded twice).
  const [ratios, prices, valuationSeries, tevSeries] = await Promise.all([
    loggedFiscalCall(logger, "market", "companyRatios", { periodType: "latest" }, () => client.companyRatios(companyKey, "latest"), summarizeRatiosPayload),
    loggedFiscalCall(logger, "valuation", "stockPrices", {}, () => client.stockPrices(companyKey), summarizeSeriesPayload),
    Promise.all(VALUATION_RATIOS.map(async (config) => {
      const series = await loggedFiscalCall(logger, "valuation", "dailyRatio", { ratioId: config.ratioId, metric: config.key }, () => client.dailyRatio(companyKey, config.ratioId), summarizeSeriesPayload);
      return [config.key, series] as const;
    })),
    // Daily EV history is best-effort; a failure here must not break the price refresh.
    loggedFiscalCall(logger, "dailyEv", "dailyRatio", { ratioId: "calculated_tev" }, () => client.dailyRatio(companyKey, "calculated_tev"), summarizeSeriesPayload)
      .catch((error) => {
        logger.log({ level: "warning", phase: "dailyEv", operation: "bestEffort", message: `Daily EV history skipped: ${errorMessage(error)}`, data: errorDiagnostic(error) });
        return null;
      })
  ]);

  const latest = selectLatestRatioRow(ratios);
  upsertMarketSnapshot(db, companyKey, latest);
  logger.log({ level: "success", phase: "market", operation: "upsertMarketSnapshot", message: "Cached latest market ratios.", data: { latestReportDate: latest?.reportDate ?? null, metrics: Object.keys(latest?.metricValues ?? {}) } });

  const ratiosByKey = Object.fromEntries(valuationSeries) as any;
  upsertValuationSnapshot(db, companyKey, buildValuationSnapshot(ratiosByKey, prices));
  logger.log({ level: "success", phase: "valuation", operation: "upsertValuationSnapshot", message: "Cached valuation ratio history and P/E band inputs.", data: { ratioSeries: valuationSeries.map(([key, values]) => ({ key, observations: values.length })), prices: prices.length } });

  if (tevSeries) {
    const evPoints = (Array.isArray(tevSeries) ? tevSeries : [])
      .map((row: any) => ({
        date: String(row.date ?? "").slice(0, 10),
        enterpriseValue: numberOrNull(row.ratio ?? row.value)
      }))
      .filter((point: { date: string; enterpriseValue: number | null }) => point.date);
    const pricePoints = prices.map((point) => ({
      date: String(point.date).slice(0, 10),
      sharePrice: stockClosePrice(point)
    }));
    upsertDailyEvHistory(db, companyKey, evPoints, pricePoints);
    logger.log({ level: "success", phase: "dailyEv", operation: "upsertDailyEvHistory", message: "Cached daily EV and price history.", data: { evPoints: evPoints.length, pricePoints: pricePoints.length } });
  }
}

async function refreshCompanyFinancials(db: DatabaseSync, companyKey: string, client: FiscalClient, logger: RefreshLogger): Promise<void> {
  // All five statement/ratio fetches are independent, so issue them concurrently.
  const [profile, ratios, income, cashFlow, balanceSheet] = await Promise.all([
    loggedFiscalCall(logger, "financials", "companyProfile", {}, () => client.companyProfile(companyKey), (payload) => ({ name: payload.name, sector: payload.sector, reportingTemplate: payload.reportingTemplate })),
    loggedFiscalCall(logger, "financials", "companyRatios", { periodType: "latest,annual" }, () => client.companyRatios(companyKey, "latest,annual"), summarizeRatiosPayload),
    loggedFiscalCall(logger, "financials", "standardizedFinancials", { statementType: "income-statement", periodType: "ltm,annual" }, () => client.standardizedFinancials(companyKey, "income-statement", "ltm,annual"), summarizeFinancialPayload),
    loggedFiscalCall(logger, "financials", "standardizedFinancials", { statementType: "cash-flow-statement", periodType: "ltm,annual" }, () => client.standardizedFinancials(companyKey, "cash-flow-statement", "ltm,annual"), summarizeFinancialPayload),
    loggedFiscalCall(logger, "financials", "standardizedFinancials", { statementType: "balance-sheet", periodType: "quarterly,annual" }, () => client.standardizedFinancials(companyKey, "balance-sheet", "quarterly,annual"), summarizeFinancialPayload)
  ]);

  upsertCompanyProfile(db, { ...profile, companyKey });
  upsertMarketSnapshot(db, companyKey, selectLatestRatioRow(ratios));
  upsertFinancialSnapshot(db, companyKey, deriveFinancialSnapshot(profile, ratios, income, cashFlow, balanceSheet));
  logger.log({ level: "success", phase: "financials", operation: "upsertFinancialSnapshot", message: "Cached company profile, market ratios, and derived financial snapshot.", data: { profileName: profile.name ?? null } });
}

function resolveRefreshCompanyKeys(db: DatabaseSync, requested: string[] | undefined, kind: RefreshKind, order: RefreshOrder): string[] {
  const rows = getCompanyRows(db);
  const rowByKey = new Map(rows.map((row) => [row.companyKey, row]));
  const requestedKeys = requested && requested.length > 0 ? requested : [...TRIAL_COMPANIES];
  const unique = [...new Set(requestedKeys)].filter((companyKey) => rowByKey.has(companyKey));
  if (order === "given") return unique;
  const freshness = (companyKey: string): string | null => {
    const row = rowByKey.get(companyKey);
    if (!row) return null;
    if (kind === "prices") return row.pricesUpdatedAt;
    if (kind === "financials") return row.financialsUpdatedAt;
    const dates = [row.pricesUpdatedAt, row.financialsUpdatedAt].filter((value): value is string => Boolean(value));
    return dates.sort()[0] ?? null;
  };
  return unique.sort((a, b) => compareFreshness(freshness(a), freshness(b), order));
}

function compareFreshness(a: string | null, b: string | null, order: RefreshOrder): number {
  if (a === b) return 0;
  if (a === null) return order === "oldest-first" ? -1 : 1;
  if (b === null) return order === "oldest-first" ? 1 : -1;
  return order === "oldest-first" ? a.localeCompare(b) : b.localeCompare(a);
}

function makeRefreshLogger(db: DatabaseSync, runId: number, itemId: number | null, companyKey: string | null): RefreshLogger {
  return {
    runId,
    itemId,
    companyKey,
    log(input) {
      appendRefreshLog(db, { refreshRunId: runId, itemId, companyKey, ...input });
    }
  };
}

async function loggedFiscalCall<T>(
  logger: RefreshLogger,
  phase: string,
  operation: string,
  params: Record<string, unknown>,
  action: () => Promise<T>,
  summarize: (payload: T) => Record<string, unknown>
): Promise<T> {
  logger.log({ level: "info", phase, operation, message: `Calling Fiscal ${operation}.`, data: { companyKey: logger.companyKey, params } });
  const startedAt = Date.now();
  try {
    const payload = await action();
    const durationMs = Date.now() - startedAt;
    logger.log({ level: "success", phase, operation, message: `Fiscal ${operation} returned successfully.`, data: { companyKey: logger.companyKey, params, summary: summarize(payload) }, durationMs });
    return payload;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logger.log({ level: "error", phase, operation, message: `Fiscal ${operation} failed: ${errorMessage(error)}`, data: { companyKey: logger.companyKey, params, error: errorDiagnostic(error) }, durationMs });
    throw error;
  }
}

function summarizeRatiosPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const rows = Array.isArray(payload.data) ? payload.data as Array<Record<string, unknown>> : [];
  return {
    rows: rows.length,
    periodTypes: [...new Set(rows.map((row) => row.periodType).filter(Boolean))],
    reportDates: rows.map((row) => row.reportDate).filter(Boolean).slice(0, 6),
    metricKeys: Object.keys((rows[0]?.metricValues as Record<string, unknown> | undefined) ?? {})
  };
}

function summarizeFinancialPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const rows = standardizedRows(payload);
  return {
    rows: rows.length,
    periodTypes: [...new Set(rows.map((row) => row.periodType).filter(Boolean))],
    reportDates: rows.map((row) => row.reportDate).filter(Boolean).slice(0, 8),
    firstMetricKeys: Object.keys(rows[0]?.metricsValues ?? {}).slice(0, 16)
  };
}

function summarizeSeriesPayload(payload: Array<Record<string, unknown>>): Record<string, unknown> {
  const dates = payload.map((row) => String(row.date ?? "").slice(0, 10)).filter(Boolean).sort();
  return {
    rows: payload.length,
    earliestDate: dates[0] ?? null,
    latestDate: dates.at(-1) ?? null,
    sampleKeys: Object.keys(payload[0] ?? {})
  };
}

function errorDiagnostic(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack?.slice(0, 2000) ?? null };
  }
  return { message: String(error) };
}

function deriveFinancialSnapshot(
  profile: Record<string, unknown>,
  ratios: Record<string, unknown>,
  income: Record<string, unknown>,
  cashFlow: Record<string, unknown>,
  balanceSheet: Record<string, unknown>
) {
  const latestRatioRow = selectLatestRatioRow(ratios);
  const latestRatioValues = latestRatioRow?.metricValues ?? {};
  const incomeRows = standardizedRows(income);
  const cashFlowRows = standardizedRows(cashFlow);
  const baseFinancials = buildFinancialBases(incomeRows, cashFlowRows);
  const evBridge = buildEvBridge(standardizedRows(balanceSheet), latestRatioValues);
  const revenueHistory = incomeRows
    .filter((row) => row.periodType === "Annual")
    .map((row) => ({
      year: row.calendarYear,
      reportDate: row.reportDate,
      value: numberOrNull(row.metricsValues.income_statement_total_revenues?.value)
    }))
    .filter((point): point is { year: number; reportDate: string; value: number } => Number.isFinite(point.value))
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate));

  const annualCashFlowRows = cashFlowRows.filter((row) => row.periodType === "Annual").sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  const fcfHistory = annualCashFlowRows
    .map((row) => {
      const revenue = revenueHistory.find((point) => point.reportDate === row.reportDate)?.value ?? null;
      const value = freeCashFlowFromRow(row);
      return {
        year: row.calendarYear,
        reportDate: row.reportDate,
        value,
        margin: value !== null && revenue && revenue > 0 ? value / revenue : null
      };
    })
    .filter((point): point is { year: number; reportDate: string; value: number; margin: number | null } => Number.isFinite(point.value));

  const standardizedLatestRevenue = revenueHistory.at(-1) ?? null;
  const inferredRevenue = inferLatestRevenue(latestRatioValues);
  const selectedBase = selectBaseFinancial(baseFinancials);
  const latestRevenue = selectedBase?.revenue ?? standardizedLatestRevenue?.value ?? inferredRevenue.value;
  const latestRevenueSource = selectedBase?.source ?? (standardizedLatestRevenue ? "Standardized income statement" : inferredRevenue.source);
  const latestRevenueReportDate = selectedBase?.reportDate ?? standardizedLatestRevenue?.reportDate ?? nullableString(latestRatioRow?.reportDate);
  const latestRevenueYear = selectedBase?.period === "annual" ? standardizedLatestRevenue?.year ?? null : null;

  const fiveYearsAgo = revenueHistory.length >= 6 ? revenueHistory.at(-6) ?? null : null;
  const standardizedRevenueCagr = standardizedLatestRevenue && fiveYearsAgo ? cagr(fiveYearsAgo.value, standardizedLatestRevenue.value, 5) : null;
  const ratioRevenueCagr = ratioValue(ratios, "growth_revenue_5y_cagr");
  const historicalRevenueCagr5y = standardizedRevenueCagr ?? ratioRevenueCagr;
  const historicalRevenueCagr5ySource = standardizedRevenueCagr !== null
    ? "Standardized 5Y revenue history"
    : ratioRevenueCagr !== null
      ? "Data fallback: growth_revenue_5y_cagr"
      : null;

  const ltmMargin = baseFinancials.ltm?.fcfMargin ?? null;
  const marginDefault = isPositive(ltmMargin)
    ? { value: ltmMargin, source: "LTM FCF / LTM revenue" }
    : chooseNormalizedFcfMargin(fcfHistory, ratios);
  const terminalGrowthDefault = normalizeTerminalGrowth(historicalRevenueCagr5y);
  const discountRateDefault = defaultDiscountRate(typeof profile.sector === "string" ? profile.sector : null);
  const exitMultipleStats = buildExitMultipleStats(ratios);
  const exitDefaults = chooseExitDefaults(exitMultipleStats);
  const ebitdaMarginDefault = chooseNormalizedEbitdaMargin(ratios);

  return {
    latestRevenue,
    latestRevenueYear,
    latestRevenueReportDate,
    historicalRevenueCagr5y,
    basePeriodDefault: selectedBase?.period ?? null,
    baseFinancials,
    evBridge,
    normalizedFcfMarginDefault: marginDefault.value,
    terminalGrowthDefault,
    discountRateDefault,
    terminalMethodDefault: exitDefaults.method,
    exitMetricDefault: exitDefaults.metric,
    exitMultipleDefault: exitDefaults.multiple,
    normalizedEbitdaMarginDefault: ebitdaMarginDefault.value,
    exitMultipleStats,
    latestRevenueSource,
    normalizedFcfMarginSource: marginDefault.source,
    historicalRevenueCagr5ySource,
    exitMultipleSource: exitDefaults.source,
    normalizedEbitdaMarginSource: ebitdaMarginDefault.source,
    revenueHistory,
    fcfHistory,
    sourceLinks: extractSourceLinks(income)
  };
}

const EXIT_MULTIPLE_CONFIG: Array<{ metric: ExitMetric; label: string; ratioId: string }> = [
  { metric: "fcf", label: "EV/FCF", ratioId: "ratio_ev_to_fcf" },
  { metric: "ebitda", label: "EV/EBITDA", ratioId: "ratio_ev_to_ebitda" },
  { metric: "revenue", label: "EV/Revenue", ratioId: "ratio_ev_to_sales" }
];

function buildExitMultipleStats(ratios: Record<string, unknown>): ExitMultipleStat[] {
  return EXIT_MULTIPLE_CONFIG.map(({ metric, label, ratioId }) => {
    const series = annualRatioValues(ratios, ratioId).slice(-5).filter(isPositive);
    const current = ratioValue(ratios, ratioId);
    return {
      metric,
      label,
      current,
      low: series.length ? Math.min(...series) : null,
      median: median(series),
      high: series.length ? Math.max(...series) : null,
      source: series.length ? `5Y median ${label}` : null
    };
  });
}

function chooseExitDefaults(stats: ExitMultipleStat[]): {
  method: "perpetuity";
  metric: ExitMetric;
  multiple: number | null;
  source: string | null;
} {
  for (const stat of stats) {
    if (isPositive(stat.median)) {
      return { method: "perpetuity", metric: stat.metric, multiple: stat.median, source: stat.source };
    }
  }
  return { method: "perpetuity", metric: "fcf", multiple: null, source: null };
}

function chooseNormalizedEbitdaMargin(ratios: Record<string, unknown>): { value: number | null; source: string | null } {
  const fiveYearMedian = median(annualRatioValues(ratios, "ratio_ebitda_margin").slice(-5));
  if (isPositive(fiveYearMedian)) {
    return { value: fiveYearMedian, source: "5Y median EBITDA margin" };
  }
  const latest = ratioValue(ratios, "ratio_ebitda_margin");
  if (isPositive(latest)) {
    return { value: latest, source: "Data fallback: latest ratio_ebitda_margin" };
  }
  return { value: fiveYearMedian ?? latest, source: null };
}

export function buildFinancialBases(incomeRows: StandardizedRow[], cashFlowRows: StandardizedRow[]): {
  ltm: FinancialBase | null;
  annual: FinancialBase | null;
} {
  return {
    ltm: buildFinancialBase("ltm", incomeRows, cashFlowRows),
    annual: buildFinancialBase("annual", incomeRows, cashFlowRows)
  };
}

function buildFinancialBase(period: BasePeriod, incomeRows: StandardizedRow[], cashFlowRows: StandardizedRow[]): FinancialBase | null {
  const periodType = period === "ltm" ? "LTM" : "Annual";
  const incomeRow = latestPeriodRow(incomeRows, periodType);
  const cashFlowRow = latestPeriodRow(cashFlowRows, periodType, incomeRow?.reportDate);
  if (!incomeRow && !cashFlowRow) return null;
  const revenue = numberOrNull(incomeRow?.metricsValues.income_statement_total_revenues?.value);
  const fcf = cashFlowRow ? freeCashFlowFromRow(cashFlowRow) : null;
  return {
    period,
    label: period === "ltm" ? "LTM" : "Latest Annual",
    revenue,
    fcf,
    fcfMargin: revenue && revenue > 0 && fcf !== null ? fcf / revenue : null,
    reportDate: nullableString(incomeRow?.reportDate ?? cashFlowRow?.reportDate),
    source: period === "ltm" ? "Fiscal standardized LTM financials" : "Fiscal standardized annual financials"
  };
}

function latestPeriodRow(rows: StandardizedRow[], periodType: string, reportDate?: string): StandardizedRow | null {
  const filtered = rows.filter((row) => row.periodType === periodType);
  if (reportDate) {
    const exact = filtered.find((row) => row.reportDate === reportDate);
    if (exact) return exact;
  }
  return filtered.sort((a, b) => a.reportDate.localeCompare(b.reportDate)).at(-1) ?? null;
}

function selectBaseFinancial(bases: { ltm: FinancialBase | null; annual: FinancialBase | null }): FinancialBase | null {
  if (hasCompleteBase(bases.ltm)) return bases.ltm;
  if (hasCompleteBase(bases.annual)) return bases.annual;
  return bases.ltm ?? bases.annual;
}

function hasCompleteBase(base: FinancialBase | null): base is FinancialBase {
  return Boolean(base && isPositive(base.revenue) && Number.isFinite(base.fcf) && Number.isFinite(base.fcfMargin));
}

function freeCashFlowFromRow(row: StandardizedRow): number | null {
  const operatingCashFlow = pickValue(row.metricsValues, [
    "cash_flow_statement_net_cash_from_operating_activities",
    "cash_flow_statement_cash_from_operating_activities"
  ]);
  const capex = pickValue(row.metricsValues, [
    "cash_flow_statement_purchases_of_property_plant_and_equipment",
    "cash_flow_statement_purchase_of_property_plant_and_equipment",
    "cash_flow_statement_capital_expenditures",
    "cash_flow_statement_net_capital_expenditure"
  ]);
  return operatingCashFlow !== null && capex !== null ? operatingCashFlow + capex : null;
}


export function buildEvBridge(balanceRows: StandardizedRow[], marketValues: Record<string, any>): EvBridge | null {
  const balanceRow = latestBalanceRow(balanceRows);
  const marketCap = numberOrNull(marketValues.calculated_market_cap);
  const fiscalEnterpriseValue = numberOrNull(marketValues.calculated_tev ?? marketValues.calculated_market_cap);
  if (!balanceRow && marketCap === null && fiscalEnterpriseValue === null) return null;
  const cash = balanceRow ? pickValue(balanceRow.metricsValues, [
    "balance_sheet_total_cash_and_cash_equivalents",
    "balance_sheet_cash_and_cash_equivalents"
  ]) : null;
  const shortTermDebt = balanceRow ? pickValue(balanceRow.metricsValues, ["balance_sheet_short_term_debt"]) : null;
  const longTermDebt = balanceRow ? pickValue(balanceRow.metricsValues, ["balance_sheet_long_term_debt"]) : null;
  const totalDebt = balanceRow ? pickValue(balanceRow.metricsValues, ["balance_sheet_total_debt"]) : null;
  const debt = totalDebt ?? sumNullable(shortTermDebt, longTermDebt);
  const leases = null;
  const preferredStock = balanceRow ? pickValue(balanceRow.metricsValues, ["balance_sheet_preferred_stock"]) : null;
  const minorityInterest = balanceRow ? pickValue(balanceRow.metricsValues, ["balance_sheet_minority_interests_and_other"]) : null;
  const netDebt = debt !== null || leases !== null || cash !== null ? (debt ?? 0) + (leases ?? 0) - (cash ?? 0) : null;
  const rebuiltEnterpriseValue = marketCap !== null
    ? marketCap + (debt ?? 0) + (leases ?? 0) + (preferredStock ?? 0) + (minorityInterest ?? 0) - (cash ?? 0)
    : null;
  const difference = rebuiltEnterpriseValue !== null && fiscalEnterpriseValue !== null ? rebuiltEnterpriseValue - fiscalEnterpriseValue : null;
  const differencePercent = difference !== null && fiscalEnterpriseValue && fiscalEnterpriseValue > 0 ? difference / fiscalEnterpriseValue : null;
  return {
    marketCap,
    cash,
    debt,
    leases,
    preferredStock,
    minorityInterest,
    netDebt,
    fiscalEnterpriseValue,
    rebuiltEnterpriseValue,
    difference,
    differencePercent,
    warning: Math.abs(differencePercent ?? 0) > 0.05 ? "Rebuilt EV differs materially from Fiscal calculated TEV." : null,
    asOfDate: nullableString(balanceRow?.reportDate),
    source: balanceRow ? "Fiscal standardized balance sheet" : null
  };
}

function latestBalanceRow(rows: StandardizedRow[]): StandardizedRow | null {
  return rows
    .filter((row) => row.periodType === "Quarterly" || row.periodType === "Annual")
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
    .at(-1) ?? null;
}

function sumNullable(...values: Array<number | null>): number | null {
  const clean = values.filter((value): value is number => Number.isFinite(value));
  return clean.length > 0 ? clean.reduce((sum, value) => sum + value, 0) : null;
}

function chooseNormalizedFcfMargin(
  fcfHistory: Array<{ margin: number | null }>,
  ratios: Record<string, unknown>
): { value: number | null; source: string | null } {
  const fiveYearMedian = median(fcfHistory.slice(-5).map((point) => point.margin));
  if (isPositive(fiveYearMedian)) {
    return { value: fiveYearMedian, source: "5Y median FCF margin" };
  }

  const positiveTenYearMedian = median(fcfHistory.slice(-10).map((point) => point.margin).filter(isPositive));
  if (isPositive(positiveTenYearMedian)) {
    return { value: positiveTenYearMedian, source: "10Y positive FCF margin fallback" };
  }

  const positiveAnnualRatioMedian = median(annualRatioValues(ratios, "ratio_fcf_margin").slice(-10).filter(isPositive));
  if (isPositive(positiveAnnualRatioMedian)) {
    return { value: positiveAnnualRatioMedian, source: "Data fallback: positive FCF margin history" };
  }

  const latestRatioMargin = ratioValue(ratios, "ratio_fcf_margin");
  if (isPositive(latestRatioMargin)) {
    return { value: latestRatioMargin, source: "Data fallback: latest ratio_fcf_margin" };
  }

  return {
    value: fiveYearMedian ?? latestRatioMargin,
    source: fiveYearMedian !== null ? "5Y median FCF margin is non-positive" : latestRatioMargin !== null ? "Data fallback is non-positive" : null
  };
}

function inferLatestRevenue(values: Record<string, any>): { value: number | null; source: string | null } {
  const enterpriseValue = numberOrNull(values.calculated_tev ?? values.calculated_market_cap);
  const marketCap = numberOrNull(values.calculated_market_cap);
  const evToSales = numberOrNull(values.ratio_ev_to_sales);
  const priceToSales = numberOrNull(values.ratio_price_to_sales);

  if (isPositive(enterpriseValue) && isPositive(evToSales)) {
    return { value: (enterpriseValue as number) / (evToSales as number), source: "Inferred from EV / EV/Sales" };
  }
  if (isPositive(marketCap) && isPositive(priceToSales)) {
    return { value: (marketCap as number) / (priceToSales as number), source: "Inferred from market cap / P/S" };
  }
  return { value: null, source: null };
}

function isPositive(value: number | null | undefined): value is number {
  return Number.isFinite(value) && (value as number) > 0;
}

function selectLatestRatioRow(ratios: Record<string, unknown>): any {
  const rows = Array.isArray(ratios.data) ? ratios.data : [];
  return rows.find((row: any) => row.periodType === "Latest") ?? rows[0] ?? null;
}

function annualRatioValues(ratios: Record<string, unknown>, key: string): number[] {
  const rows = Array.isArray(ratios.data) ? ratios.data : [];
  return rows
    .filter((row: any) => row.periodType === "Annual")
    .sort((a: any, b: any) => String(a.reportDate).localeCompare(String(b.reportDate)))
    .map((row: any) => numberOrNull(row.metricValues?.[key]))
    .filter((value): value is number => Number.isFinite(value));
}

function ratioValue(ratios: Record<string, unknown>, key: string): number | null {
  const latest = selectLatestRatioRow(ratios);
  return numberOrNull(latest?.metricValues?.[key]);
}

function standardizedRows(payload: Record<string, unknown>): StandardizedRow[] {
  return (Array.isArray(payload.data) ? payload.data : []) as StandardizedRow[];
}

function pickValue(metricsValues: Record<string, any>, keys: string[]): number | null {
  for (const key of keys) {
    const value = numberOrNull(metricsValues[key]?.value);
    if (value !== null) return value;
  }
  return null;
}

function extractSourceLinks(payload: Record<string, unknown>): Array<{ label: string; url: string }> {
  const rows = standardizedRows(payload);
  const links = new Map<string, string>();
  for (const row of rows.slice(0, 8)) {
    const revenue = row.metricsValues.income_statement_total_revenues;
    const sources = revenue?.asReportedValues?.flatMap((value: any) => value.sources ?? []) ?? [];
    const source = sources.find((item: any) => item.auditUrl || item.originalSourceUrl);
    const url = source?.auditUrl ?? source?.originalSourceUrl;
    if (url && !links.has(row.reportDate)) links.set(row.reportDate, url);
  }
  return [...links.entries()].map(([label, url]) => ({ label, url }));
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
