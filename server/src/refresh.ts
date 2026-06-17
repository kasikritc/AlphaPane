import type { DatabaseSync } from "node:sqlite";
import type { BasePeriod, EvBridge, FinancialBase } from "@alphapane/shared";
import { TRIAL_COMPANIES } from "@alphapane/shared";
import { FiscalClient } from "./fiscalClient.js";
import { cagr, defaultDiscountRate, median, normalizeTerminalGrowth } from "./math.js";
import {
  createRefreshRun,
  finishRefreshRun,
  recomputeModels,
  upsertCompanyProfile,
  upsertFinancialSnapshot,
  upsertMarketSnapshot,
  upsertValuationSnapshot
} from "./repository.js";
import { buildValuationSnapshot, VALUATION_RATIOS } from "./valuation.js";

interface StandardizedRow {
  reportDate: string;
  calendarYear: number;
  periodType?: string;
  metricsValues: Record<string, any>;
}

export async function refreshPrices(db: DatabaseSync, client = new FiscalClient()): Promise<void> {
  const runId = createRefreshRun(db, "prices");
  try {
    for (const companyKey of TRIAL_COMPANIES) {
      const ratios = await client.companyRatios(companyKey, "latest");
      const latest = selectLatestRatioRow(ratios);
      upsertMarketSnapshot(db, companyKey, latest);
      await refreshValuationSnapshot(db, companyKey, client);
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
      const [profile, ratios, income, cashFlow, balanceSheet] = await Promise.all([
        client.companyProfile(companyKey),
        client.companyRatios(companyKey, "latest,annual"),
        client.standardizedFinancials(companyKey, "income-statement", "ltm,annual"),
        client.standardizedFinancials(companyKey, "cash-flow-statement", "ltm,annual"),
        client.standardizedFinancials(companyKey, "balance-sheet", "quarterly,annual")
      ]);

      upsertCompanyProfile(db, { ...profile, companyKey });
      upsertMarketSnapshot(db, companyKey, selectLatestRatioRow(ratios));
      upsertFinancialSnapshot(db, companyKey, deriveFinancialSnapshot(profile, ratios, income, cashFlow, balanceSheet));
    }
    recomputeModels(db);
    finishRefreshRun(db, runId, "success", `Updated financial cache for ${TRIAL_COMPANIES.length} companies.`);
  } catch (error) {
    finishRefreshRun(db, runId, "failed", errorMessage(error));
    throw error;
  }
}


async function refreshValuationSnapshot(db: DatabaseSync, companyKey: string, client: FiscalClient): Promise<void> {
  const ratioEntries = await Promise.all(
    VALUATION_RATIOS.map(async (config) => [config.key, await client.dailyRatio(companyKey, config.ratioId)] as const)
  );
  const ratiosByKey = Object.fromEntries(ratioEntries) as any;
  const prices = await client.stockPrices(companyKey);
  upsertValuationSnapshot(db, companyKey, buildValuationSnapshot(ratiosByKey, prices));
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
    latestRevenueSource,
    normalizedFcfMarginSource: marginDefault.source,
    historicalRevenueCagr5ySource,
    revenueHistory,
    fcfHistory,
    sourceLinks: extractSourceLinks(income)
  };
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
