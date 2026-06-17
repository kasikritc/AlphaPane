import type { DatabaseSync } from "node:sqlite";
import { TRIAL_COMPANIES } from "@alphapane/shared";
import { FiscalClient } from "./fiscalClient.js";
import { cagr, defaultDiscountRate, median, normalizeTerminalGrowth } from "./math.js";
import {
  createRefreshRun,
  finishRefreshRun,
  recomputeModels,
  upsertCompanyProfile,
  upsertFinancialSnapshot,
  upsertMarketSnapshot
} from "./repository.js";

interface StandardizedRow {
  reportDate: string;
  calendarYear: number;
  metricsValues: Record<string, any>;
}

export async function refreshPrices(db: DatabaseSync, client = new FiscalClient()): Promise<void> {
  const runId = createRefreshRun(db, "prices");
  try {
    for (const companyKey of TRIAL_COMPANIES) {
      const ratios = await client.companyRatios(companyKey, "latest");
      const latest = selectLatestRatioRow(ratios);
      upsertMarketSnapshot(db, companyKey, latest);
    }
    recomputeModels(db);
    finishRefreshRun(db, runId, "success", `Updated market data for ${TRIAL_COMPANIES.length} companies.`);
  } catch (error) {
    finishRefreshRun(db, runId, "failed", errorMessage(error));
    throw error;
  }
}

export async function refreshFinancials(db: DatabaseSync, client = new FiscalClient()): Promise<void> {
  const runId = createRefreshRun(db, "financials");
  try {
    for (const companyKey of TRIAL_COMPANIES) {
      const [profile, ratios, income, cashFlow] = await Promise.all([
        client.companyProfile(companyKey),
        client.companyRatios(companyKey, "latest,annual"),
        client.standardizedFinancials(companyKey, "income-statement"),
        client.standardizedFinancials(companyKey, "cash-flow-statement")
      ]);

      upsertCompanyProfile(db, { ...profile, companyKey });
      upsertMarketSnapshot(db, companyKey, selectLatestRatioRow(ratios));
      upsertFinancialSnapshot(db, companyKey, deriveFinancialSnapshot(profile, ratios, income, cashFlow));
    }
    recomputeModels(db);
    finishRefreshRun(db, runId, "success", `Updated financial cache for ${TRIAL_COMPANIES.length} companies.`);
  } catch (error) {
    finishRefreshRun(db, runId, "failed", errorMessage(error));
    throw error;
  }
}

function deriveFinancialSnapshot(
  profile: Record<string, unknown>,
  ratios: Record<string, unknown>,
  income: Record<string, unknown>,
  cashFlow: Record<string, unknown>
) {
  const latestRatioRow = selectLatestRatioRow(ratios);
  const latestRatioValues = latestRatioRow?.metricValues ?? {};
  const revenueHistory = standardizedRows(income)
    .map((row) => ({
      year: row.calendarYear,
      reportDate: row.reportDate,
      value: numberOrNull(row.metricsValues.income_statement_total_revenues?.value)
    }))
    .filter((point): point is { year: number; reportDate: string; value: number } => Number.isFinite(point.value))
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate));

  const cashFlowRows = standardizedRows(cashFlow).sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  const fcfHistory = cashFlowRows
    .map((row) => {
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
      const revenue = revenueHistory.find((point) => point.reportDate === row.reportDate)?.value ?? null;
      const value = operatingCashFlow !== null && capex !== null ? operatingCashFlow + capex : null;
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
  const latestRevenue = standardizedLatestRevenue?.value ?? inferredRevenue.value;
  const latestRevenueSource = standardizedLatestRevenue
    ? "Standardized income statement"
    : inferredRevenue.source;
  const latestRevenueReportDate = standardizedLatestRevenue?.reportDate ?? nullableString(latestRatioRow?.reportDate);
  const latestRevenueYear = standardizedLatestRevenue?.year ?? null;

  const fiveYearsAgo = revenueHistory.length >= 6 ? revenueHistory.at(-6) ?? null : null;
  const standardizedRevenueCagr = standardizedLatestRevenue && fiveYearsAgo ? cagr(fiveYearsAgo.value, standardizedLatestRevenue.value, 5) : null;
  const ratioRevenueCagr = ratioValue(ratios, "growth_revenue_5y_cagr");
  const historicalRevenueCagr5y = standardizedRevenueCagr ?? ratioRevenueCagr;
  const historicalRevenueCagr5ySource = standardizedRevenueCagr !== null
    ? "Standardized 5Y revenue history"
    : ratioRevenueCagr !== null
      ? "Fiscal ratio fallback: growth_revenue_5y_cagr"
      : null;

  const marginDefault = chooseNormalizedFcfMargin(fcfHistory, ratios);
  const terminalGrowthDefault = normalizeTerminalGrowth(historicalRevenueCagr5y);
  const discountRateDefault = defaultDiscountRate(typeof profile.sector === "string" ? profile.sector : null);
  const exitMultipleDefault = chooseExitRevenueMultiple(ratios);

  return {
    latestRevenue,
    latestRevenueYear,
    latestRevenueReportDate,
    historicalRevenueCagr5y,
    normalizedFcfMarginDefault: marginDefault.value,
    terminalGrowthDefault,
    discountRateDefault,
    exitRevenueMultipleDefault: exitMultipleDefault.value,
    latestRevenueSource,
    normalizedFcfMarginSource: marginDefault.source,
    historicalRevenueCagr5ySource,
    exitRevenueMultipleSource: exitMultipleDefault.source,
    revenueHistory,
    fcfHistory,
    sourceLinks: extractSourceLinks(income)
  };
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
    return { value: positiveAnnualRatioMedian, source: "Fiscal ratio fallback: positive FCF margin history" };
  }

  const latestRatioMargin = ratioValue(ratios, "ratio_fcf_margin");
  if (isPositive(latestRatioMargin)) {
    return { value: latestRatioMargin, source: "Fiscal ratio fallback: latest ratio_fcf_margin" };
  }

  return {
    value: fiveYearMedian ?? latestRatioMargin,
    source: fiveYearMedian !== null ? "5Y median FCF margin is non-positive" : latestRatioMargin !== null ? "Fiscal ratio fallback is non-positive" : null
  };
}

function chooseExitRevenueMultiple(ratios: Record<string, unknown>): { value: number | null; source: string | null } {
  const annualEvSales = median(annualRatioValues(ratios, "ratio_ev_to_sales").slice(-5));
  if (isPositive(annualEvSales)) return { value: annualEvSales, source: "5Y median EV/Sales" };

  const latestEvSales = ratioValue(ratios, "ratio_ev_to_sales");
  if (isPositive(latestEvSales)) return { value: latestEvSales, source: "Fiscal ratio fallback: latest EV/Sales" };

  const annualPriceSales = median(annualRatioValues(ratios, "ratio_price_to_sales").slice(-5));
  if (isPositive(annualPriceSales)) return { value: annualPriceSales, source: "Fiscal ratio fallback: 5Y median P/S" };

  const latestPriceSales = ratioValue(ratios, "ratio_price_to_sales");
  if (isPositive(latestPriceSales)) return { value: latestPriceSales, source: "Fiscal ratio fallback: latest P/S" };

  return { value: null, source: null };
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

