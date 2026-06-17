import type { DatabaseSync } from "node:sqlite";
import type { AssumptionSet, AssumptionSources, ColumnPreference, CompanyDetail, CompanyRow, ModelCell, RefreshRun, ValuationDetail, ValuationHistoryPoint, ValuationMetricKey, ValuationMetricStats, ValuationRow } from "@alphapane/shared";
import { TRIAL_COMPANIES } from "@alphapane/shared";
import { buildModel, median } from "./math.js";
import { VALUATION_RATIOS } from "./valuation.js";
import type { ValuationSnapshotInput } from "./valuation.js";

const GRID_COLUMNS = ["Base", "Y1", "Y2", "Y3", "Y4", "Y5", "Terminal / EV"];

interface JoinedCompany {
  company_key: string;
  ticker: string;
  exchange: string;
  name: string;
  sector: string | null;
  industry: string | null;
  reporting_template: string | null;
  terminal_url: string | null;
  caution: string | null;
  share_price: number | null;
  enterprise_value: number | null;
  ev_to_revenue: number | null;
  latest_revenue: number | null;
  historical_revenue_cagr_5y: number | null;
  normalized_fcf_margin_default: number | null;
  normalized_fcf_margin_source: string | null;
  latest_revenue_source: string | null;
  historical_revenue_cagr_5y_source: string | null;
  exit_revenue_multiple_source: string | null;
  discount_rate_default: number | null;
  terminal_growth_default: number | null;
  exit_revenue_multiple_default: number | null;
  override_margin: number | null;
  override_discount_rate: number | null;
  override_terminal_growth: number | null;
  override_exit_multiple: number | null;
  implied_revenue_cagr: number | null;
  implied_revenue_cagr_exit: number | null;
  cagr_gap: number | null;
  signal: CompanyRow["signal"];
  financials_updated_at: string | null;
  prices_updated_at: string | null;
  model_updated_at: string | null;
  is_favorite: number | null;
  note: string | null;
}

export function getCompanyRows(db: DatabaseSync): CompanyRow[] {
  const rows = db.prepare(rowSql()).all() as unknown as JoinedCompany[];
  return rows.map(toCompanyRow);
}

export function getCompanyDetail(db: DatabaseSync, companyKey: string): CompanyDetail | null {
  const joined = db.prepare(`${rowSql()} WHERE c.company_key = ?`).get(companyKey) as unknown as JoinedCompany | undefined;
  if (!joined) return null;
  const financial = db
    .prepare("SELECT revenue_history_json, fcf_history_json, source_links_json FROM financial_snapshots WHERE company_key = ?")
    .get(companyKey) as { revenue_history_json?: string; fcf_history_json?: string; source_links_json?: string } | undefined;
  const model = db
    .prepare("SELECT model_grid_json FROM model_outputs WHERE company_key = ?")
    .get(companyKey) as { model_grid_json?: string } | undefined;

  const overrides = getAssumptionOverrides(joined);
  const defaults = getAssumptionDefaults(joined);
  const gridRows = markOverrides(parseJson<ModelCell[]>(model?.model_grid_json, []), overrides);

  return {
    row: toCompanyRow(joined),
    defaults,
    overrides,
    sources: getAssumptionSources(joined),
    gridColumns: GRID_COLUMNS,
    gridRows,
    revenueHistory: parseJson(financial?.revenue_history_json, []),
    fcfHistory: parseJson(financial?.fcf_history_json, []),
    sourceLinks: parseJson(financial?.source_links_json, [])
  };
}

export function saveCompanyState(db: DatabaseSync, companyKey: string, input: { isFavorite?: boolean; note?: string }): void {
  const current = db.prepare("SELECT is_favorite, note FROM user_company_state WHERE company_key = ?").get(companyKey) as
    | { is_favorite: number; note: string }
    | undefined;
  const isFavorite = input.isFavorite ?? Boolean(current?.is_favorite);
  const note = input.note ?? current?.note ?? "";
  db.prepare(`
    INSERT INTO user_company_state (company_key, is_favorite, note, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(company_key) DO UPDATE SET
      is_favorite = excluded.is_favorite,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run(companyKey, isFavorite ? 1 : 0, note, now());
}

export function saveAssumptions(db: DatabaseSync, companyKey: string, input: Partial<AssumptionSet>): void {
  const current = db.prepare("SELECT * FROM assumption_overrides WHERE company_key = ?").get(companyKey) as
    | {
        normalized_fcf_margin: number | null;
        discount_rate: number | null;
        terminal_growth: number | null;
        exit_revenue_multiple: number | null;
      }
    | undefined;
  db.prepare(`
    INSERT INTO assumption_overrides (
      company_key, normalized_fcf_margin, discount_rate, terminal_growth, exit_revenue_multiple, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_key) DO UPDATE SET
      normalized_fcf_margin = excluded.normalized_fcf_margin,
      discount_rate = excluded.discount_rate,
      terminal_growth = excluded.terminal_growth,
      exit_revenue_multiple = excluded.exit_revenue_multiple,
      updated_at = excluded.updated_at
  `).run(
    companyKey,
    cleanNumber(input.normalizedFcfMargin, current?.normalized_fcf_margin ?? null),
    cleanNumber(input.discountRate, current?.discount_rate ?? null),
    cleanNumber(input.terminalGrowth, current?.terminal_growth ?? null),
    cleanNumber(input.exitRevenueMultiple, current?.exit_revenue_multiple ?? null),
    now()
  );
  recomputeModels(db, [companyKey]);
}

export function backfillFallbacksFromCache(db: DatabaseSync): void {
  const rows = db.prepare(`
    SELECT
      c.company_key,
      f.latest_revenue,
      f.historical_revenue_cagr_5y,
      f.normalized_fcf_margin_default,
      f.exit_revenue_multiple_default,
      f.revenue_history_json,
      f.fcf_history_json,
      f.latest_revenue_source,
      f.normalized_fcf_margin_source,
      f.historical_revenue_cagr_5y_source,
      f.exit_revenue_multiple_source,
      m.enterprise_value,
      m.market_cap,
      m.ev_to_revenue,
      m.price_to_sales
    FROM companies c
    LEFT JOIN financial_snapshots f ON f.company_key = c.company_key
    LEFT JOIN market_snapshots m ON m.company_key = c.company_key
  `).all() as Array<Record<string, unknown>>;

  const update = db.prepare(`
    UPDATE financial_snapshots SET
      latest_revenue = ?,
      normalized_fcf_margin_default = ?,
      exit_revenue_multiple_default = ?,
      latest_revenue_source = COALESCE(?, latest_revenue_source),
      normalized_fcf_margin_source = COALESCE(?, normalized_fcf_margin_source),
      historical_revenue_cagr_5y_source = COALESCE(historical_revenue_cagr_5y_source, ?),
      exit_revenue_multiple_source = COALESCE(?, exit_revenue_multiple_source),
      updated_at = ?
    WHERE company_key = ?
  `);

  for (const row of rows) {
    const revenueHistory = parseJson<Array<{ value: number; reportDate: string }>>(stringOrUndefined(row.revenue_history_json), []);
    const fcfHistory = parseJson<Array<{ value: number; margin: number | null; reportDate: string }>>(stringOrUndefined(row.fcf_history_json), []);
    const inferredRevenue = inferRevenueFromCache(row);
    const latestRevenue = numberOrNull(row.latest_revenue) ?? inferredRevenue.value;
    const latestRevenueSource = numberOrNull(row.latest_revenue) !== null ? nullableString(row.latest_revenue_source) : inferredRevenue.source;
    const fcfFallback = chooseCachedMarginFallback(fcfHistory, latestRevenue);
    const currentMargin = numberOrNull(row.normalized_fcf_margin_default);
    const normalizedFcfMargin = isPositive(currentMargin) ? currentMargin : fcfFallback.value ?? currentMargin;
    const normalizedFcfMarginSource = isPositive(currentMargin)
      ? nullableString(row.normalized_fcf_margin_source) ?? "5Y median FCF margin"
      : fcfFallback.source ?? nullableString(row.normalized_fcf_margin_source);
    const exitFallback = chooseCachedExitMultiple(row);
    const exitRevenueMultiple = numberOrNull(row.exit_revenue_multiple_default) ?? exitFallback.value;
    const exitRevenueMultipleSource = numberOrNull(row.exit_revenue_multiple_default) !== null
      ? nullableString(row.exit_revenue_multiple_source)
      : exitFallback.source;
    const historySource = revenueHistory.length >= 6 ? "Standardized 5Y revenue history" : null;

    if (latestRevenue !== null || normalizedFcfMargin !== null || exitRevenueMultiple !== null) {
      update.run(
        latestRevenue,
        normalizedFcfMargin,
        exitRevenueMultiple,
        latestRevenueSource,
        normalizedFcfMarginSource,
        historySource,
        exitRevenueMultipleSource,
        now(),
        row.company_key
      );
    }
  }
  recomputeModels(db);
}

function chooseCachedMarginFallback(
  fcfHistory: Array<{ value: number; margin: number | null }>,
  latestRevenue: number | null
): { value: number | null; source: string | null } {
  const positiveTenYearMedian = median(fcfHistory.slice(-10).map((point) => point.margin).filter(isPositive));
  if (isPositive(positiveTenYearMedian)) {
    return { value: positiveTenYearMedian, source: "10Y positive FCF margin fallback" };
  }
  const latestFcf = fcfHistory.at(-1)?.value ?? null;
  if (isPositive(latestFcf) && isPositive(latestRevenue)) {
    return { value: latestFcf / latestRevenue, source: "Latest FCF / inferred revenue fallback" };
  }
  return { value: null, source: null };
}

function inferRevenueFromCache(row: Record<string, unknown>): { value: number | null; source: string | null } {
  const enterpriseValue = numberOrNull(row.enterprise_value);
  const evToRevenue = numberOrNull(row.ev_to_revenue);
  const marketCap = numberOrNull(row.market_cap);
  const priceToSales = numberOrNull(row.price_to_sales);
  if (isPositive(enterpriseValue) && isPositive(evToRevenue)) {
    return { value: enterpriseValue / evToRevenue, source: "Inferred from EV / EV/Sales" };
  }
  if (isPositive(marketCap) && isPositive(priceToSales)) {
    return { value: marketCap / priceToSales, source: "Inferred from market cap / P/S" };
  }
  return { value: null, source: null };
}

function chooseCachedExitMultiple(row: Record<string, unknown>): { value: number | null; source: string | null } {
  const evToRevenue = numberOrNull(row.ev_to_revenue);
  if (isPositive(evToRevenue)) return { value: evToRevenue, source: "Fiscal ratio fallback: latest EV/Sales" };
  const priceToSales = numberOrNull(row.price_to_sales);
  if (isPositive(priceToSales)) return { value: priceToSales, source: "Fiscal ratio fallback: latest P/S" };
  return { value: null, source: null };
}

function isPositive(value: number | null | undefined): value is number {
  return Number.isFinite(value) && (value as number) > 0;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function getColumnPreferences(db: DatabaseSync, key = "reverseDcfColumns"): ColumnPreference[] {
  const row = db.prepare("SELECT value_json FROM preferences WHERE key = ?").get(key) as { value_json?: string } | undefined;
  if (row?.value_json) return parseJson(row.value_json, []);
  if (key === "reverseDcfColumns") {
    const legacy = db.prepare("SELECT value_json FROM preferences WHERE key = ?").get("columns") as { value_json?: string } | undefined;
    return parseJson(legacy?.value_json, []);
  }
  return [];
}

export function saveColumnPreferences(db: DatabaseSync, preferences: ColumnPreference[], key = "reverseDcfColumns"): void {
  db.prepare(`
    INSERT INTO preferences (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(preferences), now());
}

export function createRefreshRun(db: DatabaseSync, kind: "prices" | "financials"): number {
  const result = db
    .prepare("INSERT INTO refresh_runs (kind, status, started_at) VALUES (?, 'running', ?)")
    .run(kind, now());
  return Number(result.lastInsertRowid);
}

export function finishRefreshRun(db: DatabaseSync, id: number, status: "success" | "failed", message: string | null): void {
  db.prepare("UPDATE refresh_runs SET status = ?, finished_at = ?, message = ? WHERE id = ?").run(status, now(), message, id);
}

export function getRefreshRuns(db: DatabaseSync): RefreshRun[] {
  const rows = db.prepare("SELECT * FROM refresh_runs ORDER BY id DESC LIMIT 20").all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind as RefreshRun["kind"],
    status: row.status as RefreshRun["status"],
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    message: row.message ? String(row.message) : null
  }));
}

export function upsertCompanyProfile(db: DatabaseSync, profile: Record<string, unknown>): void {
  const companyKey = String(profile.companyKey ?? `${profile.exchangeSymbol}_${profile.ticker}`);
  const caution = profile.reportingTemplate === "Financials" || profile.reportingTemplate === "Insurance"
    ? "EV-based DCF is less reliable for banks, insurers, and other financial companies."
    : null;
  db.prepare(`
    UPDATE companies SET
      name = COALESCE(?, name),
      sector = ?,
      industry = ?,
      reporting_template = ?,
      reporting_currency = ?,
      trading_currency = ?,
      terminal_url = ?,
      caution = ?,
      profile_json = ?,
      updated_at = ?
    WHERE company_key = ?
  `).run(
    nullableString(profile.name),
    nullableString(profile.sector),
    nullableString(profile.industry),
    nullableString(profile.reportingTemplate),
    nullableString(profile.reportingCurrency),
    nullableString(profile.tradingCurrency),
    nullableString(profile.terminalUrl),
    caution,
    JSON.stringify(profile),
    now(),
    companyKey
  );
}

export function upsertMarketSnapshot(db: DatabaseSync, companyKey: string, latestRatioRow: any): void {
  const values = latestRatioRow?.metricValues ?? {};
  const enterpriseValue = numberOrNull(values.calculated_tev ?? values.calculated_market_cap);
  db.prepare(`
    INSERT INTO market_snapshots (
      company_key, share_price, market_cap, enterprise_value, ev_to_revenue,
      price_to_sales, price_to_earnings, as_of_date, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_key) DO UPDATE SET
      share_price = excluded.share_price,
      market_cap = excluded.market_cap,
      enterprise_value = excluded.enterprise_value,
      ev_to_revenue = excluded.ev_to_revenue,
      price_to_sales = excluded.price_to_sales,
      price_to_earnings = excluded.price_to_earnings,
      as_of_date = excluded.as_of_date,
      updated_at = excluded.updated_at
  `).run(
    companyKey,
    numberOrNull(values.market_data_share_price),
    numberOrNull(values.calculated_market_cap),
    enterpriseValue,
    numberOrNull(values.ratio_ev_to_sales),
    numberOrNull(values.ratio_price_to_sales),
    numberOrNull(values.ratio_price_to_earnings),
    nullableString(latestRatioRow?.reportDate),
    now()
  );
}

export function upsertFinancialSnapshot(
  db: DatabaseSync,
  companyKey: string,
  input: {
    latestRevenue: number | null;
    latestRevenueYear: number | null;
    latestRevenueReportDate: string | null;
    historicalRevenueCagr5y: number | null;
    normalizedFcfMarginDefault: number | null;
    terminalGrowthDefault: number | null;
    discountRateDefault: number | null;
    exitRevenueMultipleDefault: number | null;
    latestRevenueSource: string | null;
    normalizedFcfMarginSource: string | null;
    historicalRevenueCagr5ySource: string | null;
    exitRevenueMultipleSource: string | null;
    revenueHistory: unknown[];
    fcfHistory: unknown[];
    sourceLinks: unknown[];
  }
): void {
  db.prepare(`
    INSERT INTO financial_snapshots (
      company_key, latest_revenue, latest_revenue_year, latest_revenue_report_date,
      historical_revenue_cagr_5y, normalized_fcf_margin_default, normalized_fcf_margin_source,
      latest_revenue_source, historical_revenue_cagr_5y_source, exit_revenue_multiple_source,
      terminal_growth_default, discount_rate_default, exit_revenue_multiple_default, revenue_history_json,
      fcf_history_json, source_links_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_key) DO UPDATE SET
      latest_revenue = excluded.latest_revenue,
      latest_revenue_year = excluded.latest_revenue_year,
      latest_revenue_report_date = excluded.latest_revenue_report_date,
      historical_revenue_cagr_5y = excluded.historical_revenue_cagr_5y,
      normalized_fcf_margin_default = excluded.normalized_fcf_margin_default,
      normalized_fcf_margin_source = excluded.normalized_fcf_margin_source,
      latest_revenue_source = excluded.latest_revenue_source,
      historical_revenue_cagr_5y_source = excluded.historical_revenue_cagr_5y_source,
      exit_revenue_multiple_source = excluded.exit_revenue_multiple_source,
      terminal_growth_default = excluded.terminal_growth_default,
      discount_rate_default = excluded.discount_rate_default,
      exit_revenue_multiple_default = excluded.exit_revenue_multiple_default,
      revenue_history_json = excluded.revenue_history_json,
      fcf_history_json = excluded.fcf_history_json,
      source_links_json = excluded.source_links_json,
      updated_at = excluded.updated_at
  `).run(
    companyKey,
    input.latestRevenue,
    input.latestRevenueYear,
    input.latestRevenueReportDate,
    input.historicalRevenueCagr5y,
    input.normalizedFcfMarginDefault,
    input.normalizedFcfMarginSource,
    input.latestRevenueSource,
    input.historicalRevenueCagr5ySource,
    input.exitRevenueMultipleSource,
    input.terminalGrowthDefault,
    input.discountRateDefault,
    input.exitRevenueMultipleDefault,
    JSON.stringify(input.revenueHistory),
    JSON.stringify(input.fcfHistory),
    JSON.stringify(input.sourceLinks),
    now()
  );
}

export function recomputeModels(db: DatabaseSync, companyKeys: readonly string[] = TRIAL_COMPANIES): void {
  const statement = db.prepare(`
    SELECT
      c.company_key,
      m.enterprise_value,
      f.latest_revenue,
      f.historical_revenue_cagr_5y,
      COALESCE(a.normalized_fcf_margin, f.normalized_fcf_margin_default) AS normalized_fcf_margin,
      COALESCE(a.discount_rate, f.discount_rate_default) AS discount_rate,
      COALESCE(a.terminal_growth, f.terminal_growth_default) AS terminal_growth,
      COALESCE(a.exit_revenue_multiple, f.exit_revenue_multiple_default) AS exit_revenue_multiple
    FROM companies c
    LEFT JOIN market_snapshots m ON m.company_key = c.company_key
    LEFT JOIN financial_snapshots f ON f.company_key = c.company_key
    LEFT JOIN assumption_overrides a ON a.company_key = c.company_key
    WHERE c.company_key = ?
  `);
  const upsert = db.prepare(`
    INSERT INTO model_outputs (
      company_key, implied_revenue_cagr, implied_revenue_cagr_exit, cagr_gap,
      signal, model_grid_json, status, status_message, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_key) DO UPDATE SET
      implied_revenue_cagr = excluded.implied_revenue_cagr,
      implied_revenue_cagr_exit = excluded.implied_revenue_cagr_exit,
      cagr_gap = excluded.cagr_gap,
      signal = excluded.signal,
      model_grid_json = excluded.model_grid_json,
      status = excluded.status,
      status_message = excluded.status_message,
      updated_at = excluded.updated_at
  `);
  for (const companyKey of companyKeys) {
    const row = statement.get(companyKey) as Record<string, unknown> | undefined;
    if (!row) continue;
    const output = buildModel({
      enterpriseValue: numberOrNull(row.enterprise_value),
      baseRevenue: numberOrNull(row.latest_revenue),
      normalizedFcfMargin: numberOrNull(row.normalized_fcf_margin),
      discountRate: numberOrNull(row.discount_rate),
      terminalGrowth: numberOrNull(row.terminal_growth),
      historicalRevenueCagr5y: numberOrNull(row.historical_revenue_cagr_5y),
      exitRevenueMultiple: numberOrNull(row.exit_revenue_multiple)
    });
    upsert.run(
      companyKey,
      output.impliedRevenueCagr,
      output.impliedRevenueCagrExit,
      output.cagrGap,
      output.signal,
      JSON.stringify(output.gridRows),
      output.status,
      output.statusMessage,
      now()
    );
  }
}

function rowSql(): string {
  return `
    SELECT
      c.company_key, c.ticker, c.exchange, c.name, c.sector, c.industry,
      c.reporting_template, c.terminal_url, c.caution,
      m.share_price, m.enterprise_value, m.ev_to_revenue, m.updated_at AS prices_updated_at,
      f.latest_revenue, f.historical_revenue_cagr_5y, f.normalized_fcf_margin_default,
      f.normalized_fcf_margin_source, f.latest_revenue_source, f.historical_revenue_cagr_5y_source,
      f.exit_revenue_multiple_source, f.discount_rate_default, f.terminal_growth_default, f.exit_revenue_multiple_default,
      f.updated_at AS financials_updated_at,
      a.normalized_fcf_margin AS override_margin,
      a.discount_rate AS override_discount_rate,
      a.terminal_growth AS override_terminal_growth,
      a.exit_revenue_multiple AS override_exit_multiple,
      o.implied_revenue_cagr, o.implied_revenue_cagr_exit, o.cagr_gap, o.signal,
      o.updated_at AS model_updated_at,
      u.is_favorite, u.note
    FROM companies c
    LEFT JOIN market_snapshots m ON m.company_key = c.company_key
    LEFT JOIN financial_snapshots f ON f.company_key = c.company_key
    LEFT JOIN assumption_overrides a ON a.company_key = c.company_key
    LEFT JOIN model_outputs o ON o.company_key = c.company_key
    LEFT JOIN user_company_state u ON u.company_key = c.company_key
  `;
}

function toCompanyRow(row: JoinedCompany): CompanyRow {
  const normalizedFcfMargin = row.override_margin ?? row.normalized_fcf_margin_default;
  const discountRate = row.override_discount_rate ?? row.discount_rate_default;
  const terminalGrowth = row.override_terminal_growth ?? row.terminal_growth_default;
  const exitRevenueMultiple = row.override_exit_multiple ?? row.exit_revenue_multiple_default;
  return {
    companyKey: row.company_key,
    ticker: row.ticker,
    exchange: row.exchange,
    name: row.name,
    sector: row.sector,
    industry: row.industry,
    reportingTemplate: row.reporting_template,
    terminalUrl: row.terminal_url,
    sharePrice: numberOrNull(row.share_price),
    enterpriseValue: numberOrNull(row.enterprise_value),
    latestRevenue: numberOrNull(row.latest_revenue),
    evToRevenue: numberOrNull(row.ev_to_revenue),
    historicalRevenueCagr5y: numberOrNull(row.historical_revenue_cagr_5y),
    normalizedFcfMargin: numberOrNull(normalizedFcfMargin),
    discountRate: numberOrNull(discountRate),
    terminalGrowth: numberOrNull(terminalGrowth),
    exitRevenueMultiple: numberOrNull(exitRevenueMultiple),
    latestRevenueSource: row.latest_revenue_source,
    normalizedFcfMarginSource: row.override_margin !== null ? "User override" : row.normalized_fcf_margin_source,
    historicalRevenueCagrSource: row.historical_revenue_cagr_5y_source,
    exitRevenueMultipleSource: row.override_exit_multiple !== null ? "User override" : row.exit_revenue_multiple_source,
    impliedRevenueCagr: numberOrNull(row.implied_revenue_cagr),
    impliedRevenueCagrExit: numberOrNull(row.implied_revenue_cagr_exit),
    cagrGap: numberOrNull(row.cagr_gap),
    signal: row.signal ?? "insufficient data",
    isFavorite: Boolean(row.is_favorite),
    note: row.note ?? "",
    financialsUpdatedAt: row.financials_updated_at,
    pricesUpdatedAt: row.prices_updated_at,
    modelUpdatedAt: row.model_updated_at,
    caution: row.caution
  };
}

function getAssumptionSources(row: JoinedCompany): AssumptionSources {
  return {
    latestRevenue: row.latest_revenue_source,
    normalizedFcfMargin: row.override_margin !== null ? "User override" : row.normalized_fcf_margin_source,
    historicalRevenueCagr5y: row.historical_revenue_cagr_5y_source,
    exitRevenueMultiple: row.override_exit_multiple !== null ? "User override" : row.exit_revenue_multiple_source
  };
}

function getAssumptionDefaults(row: JoinedCompany): AssumptionSet {
  return {
    normalizedFcfMargin: numberOrNull(row.normalized_fcf_margin_default),
    discountRate: numberOrNull(row.discount_rate_default),
    terminalGrowth: numberOrNull(row.terminal_growth_default),
    exitRevenueMultiple: numberOrNull(row.exit_revenue_multiple_default)
  };
}

function getAssumptionOverrides(row: JoinedCompany): AssumptionSet {
  return {
    normalizedFcfMargin: numberOrNull(row.override_margin),
    discountRate: numberOrNull(row.override_discount_rate),
    terminalGrowth: numberOrNull(row.override_terminal_growth),
    exitRevenueMultiple: numberOrNull(row.override_exit_multiple)
  };
}

function markOverrides(rows: ModelCell[], overrides: AssumptionSet): ModelCell[] {
  const labels: Record<string, keyof AssumptionSet> = {
    "Normalized FCF margin": "normalizedFcfMargin",
    "Discount rate": "discountRate",
    "Terminal growth": "terminalGrowth",
    "Exit revenue multiple": "exitRevenueMultiple"
  };
  return rows.map((row) => {
    const overrideKey = labels[row.label];
    return overrideKey && overrides[overrideKey] !== null ? { ...row, kind: "override" } : row;
  });
}


interface ValuationJoined {
  company_key: string;
  ticker: string;
  exchange: string;
  name: string;
  sector: string | null;
  industry: string | null;
  terminal_url: string | null;
  share_price: number | null;
  metrics_json?: string;
  pe_history_json?: string;
  pe_band_levels_json?: string;
  valuation_updated_at: string | null;
  is_favorite: number | null;
  note: string | null;
}

export function upsertValuationSnapshot(db: DatabaseSync, companyKey: string, input: ValuationSnapshotInput): void {
  db.prepare(`
    INSERT INTO valuation_snapshots (company_key, metrics_json, pe_history_json, pe_band_levels_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(company_key) DO UPDATE SET
      metrics_json = excluded.metrics_json,
      pe_history_json = excluded.pe_history_json,
      pe_band_levels_json = excluded.pe_band_levels_json,
      updated_at = excluded.updated_at
  `).run(
    companyKey,
    JSON.stringify(input.metrics),
    JSON.stringify(input.peHistory),
    JSON.stringify(input.peBandLevels),
    now()
  );
}

export function getValuationRows(db: DatabaseSync): ValuationRow[] {
  const rows = db.prepare(valuationRowSql()).all() as unknown as ValuationJoined[];
  return rows.map(toValuationRow).sort((a, b) => compareNullable(a.pe.zScore, b.pe.zScore));
}

export function getValuationDetail(db: DatabaseSync, companyKey: string): ValuationDetail | null {
  const joined = db.prepare(`${valuationRowSql()} WHERE c.company_key = ?`).get(companyKey) as unknown as ValuationJoined | undefined;
  if (!joined) return null;
  const row = toValuationRow(joined);
  return {
    row,
    metrics: [row.pe, row.evSales, row.evEbitda, row.priceSales, row.fcfYield],
    peHistory: parseJson<ValuationHistoryPoint[]>(joined.pe_history_json, []),
    peBandLevels: parseJson<Record<string, number | null>>(joined.pe_band_levels_json, {})
  };
}

function valuationRowSql(): string {
  return `
    SELECT
      c.company_key, c.ticker, c.exchange, c.name, c.sector, c.industry, c.terminal_url,
      m.share_price,
      v.metrics_json, v.pe_history_json, v.pe_band_levels_json, v.updated_at AS valuation_updated_at,
      u.is_favorite, u.note
    FROM companies c
    LEFT JOIN market_snapshots m ON m.company_key = c.company_key
    LEFT JOIN valuation_snapshots v ON v.company_key = c.company_key
    LEFT JOIN user_company_state u ON u.company_key = c.company_key
  `;
}

function toValuationRow(row: ValuationJoined): ValuationRow {
  const metrics = completeMetrics(parseJson<Partial<Record<ValuationMetricKey, ValuationMetricStats>>>(row.metrics_json, {}));
  return {
    companyKey: row.company_key,
    ticker: row.ticker,
    exchange: row.exchange,
    name: row.name,
    sector: row.sector,
    industry: row.industry,
    terminalUrl: row.terminal_url,
    sharePrice: numberOrNull(row.share_price),
    pe: metrics.pe,
    evSales: metrics.evSales,
    evEbitda: metrics.evEbitda,
    priceSales: metrics.priceSales,
    fcfYield: metrics.fcfYield,
    isFavorite: Boolean(row.is_favorite),
    note: row.note ?? "",
    valuationUpdatedAt: row.valuation_updated_at
  };
}

function completeMetrics(input: Partial<Record<ValuationMetricKey, ValuationMetricStats>>): Record<ValuationMetricKey, ValuationMetricStats> {
  return Object.fromEntries(VALUATION_RATIOS.map((config) => [config.key, input[config.key] ?? emptyMetric(config)])) as Record<ValuationMetricKey, ValuationMetricStats>;
}

function emptyMetric(config: (typeof VALUATION_RATIOS)[number]): ValuationMetricStats {
  return {
    key: config.key,
    label: config.label,
    ratioId: config.ratioId,
    current: null,
    mean: null,
    stdDev: null,
    zScore: null,
    percentileRank: null,
    observationCount: 0,
    status: "insufficient data"
  };
}

function compareNullable(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cleanNumber(value: number | null | undefined, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  return Number.isFinite(value) ? Number(value) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function now(): string {
  return new Date().toISOString();
}

