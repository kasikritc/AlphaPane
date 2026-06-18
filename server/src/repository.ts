import type { DatabaseSync } from "node:sqlite";
import type { AssumptionSet, AssumptionSources, BasePeriod, ColumnPreference, CompanyDetail, CompanyRow, DailyEvPoint, EvBridge, ExitMetric, ExitMultipleStat, FinancialBase, ImpliedGrowthHistoryData, ModelCell, ModelDiagnostics, RealizedGrowthPoint, RefreshRun, SensitivityTable, TerminalMethod, ValuationDetail, ValuationHistoryPoint, ValuationMetricKey, ValuationMetricStats, ValuationRow } from "@alphapane/shared";
import { TRIAL_COMPANIES, computeRealizedGrowth } from "@alphapane/shared";
import { buildModel, buildSensitivity, median } from "./math.js";
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
  market_cap: number | null;
  enterprise_value: number | null;
  ev_to_revenue: number | null;
  latest_revenue: number | null;
  historical_revenue_cagr_5y: number | null;
  base_period_default: string | null;
  base_financials_json: string | null;
  ev_bridge_json: string | null;
  normalized_fcf_margin_default: number | null;
  normalized_fcf_margin_source: string | null;
  latest_revenue_source: string | null;
  historical_revenue_cagr_5y_source: string | null;
  discount_rate_default: number | null;
  terminal_growth_default: number | null;
  terminal_method_default: string | null;
  exit_metric_default: string | null;
  exit_multiple_default: number | null;
  exit_multiple_source: string | null;
  normalized_ebitda_margin_default: number | null;
  normalized_ebitda_margin_source: string | null;
  override_base_period: string | null;
  override_margin: number | null;
  override_discount_rate: number | null;
  override_terminal_growth: number | null;
  override_terminal_method: string | null;
  override_exit_metric: string | null;
  override_exit_multiple: number | null;
  override_normalized_ebitda_margin: number | null;
  implied_revenue_cagr: number | null;
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
    .prepare("SELECT base_financials_json, ev_bridge_json, exit_multiple_stats_json, revenue_history_json, fcf_history_json, source_links_json FROM financial_snapshots WHERE company_key = ?")
    .get(companyKey) as { base_financials_json?: string; ev_bridge_json?: string; exit_multiple_stats_json?: string; revenue_history_json?: string; fcf_history_json?: string; source_links_json?: string } | undefined;
  const model = db
    .prepare("SELECT model_grid_json, diagnostics_json, sensitivity_json FROM model_outputs WHERE company_key = ?")
    .get(companyKey) as { model_grid_json?: string; diagnostics_json?: string; sensitivity_json?: string } | undefined;

  const overrides = getAssumptionOverrides(joined);
  const defaults = getAssumptionDefaults(joined);
  const gridRows = markOverrides(parseJson<ModelCell[]>(model?.model_grid_json, []), overrides);
  const bases = parseBaseFinancials(financial?.base_financials_json ?? joined.base_financials_json);
  const selected = selectBasePeriod(overrides.basePeriod ?? defaults.basePeriod, bases);
  const evBridge = buildCurrentEvBridge(parseJson<Partial<EvBridge>>(financial?.ev_bridge_json ?? joined.ev_bridge_json ?? undefined, {}), numberOrNull(joined.market_cap), numberOrNull(joined.enterprise_value));

  return {
    row: toCompanyRow(joined),
    defaults,
    overrides,
    sources: getAssumptionSources(joined),
    baseFinancials: { selected, ...bases },
    evBridge,
    diagnostics: parseJson<ModelDiagnostics | null>(model?.diagnostics_json, null),
    exitMultipleStats: parseJson<ExitMultipleStat[]>(financial?.exit_multiple_stats_json, []),
    sensitivity: parseJson<SensitivityTable[]>(model?.sensitivity_json, []),
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
        base_period: string | null;
        normalized_fcf_margin: number | null;
        discount_rate: number | null;
        terminal_growth: number | null;
        terminal_method: string | null;
        exit_metric: string | null;
        exit_multiple: number | null;
        normalized_ebitda_margin: number | null;
      }
    | undefined;
  db.prepare(`
    INSERT INTO assumption_overrides (
      company_key, base_period, normalized_fcf_margin, discount_rate, terminal_growth,
      terminal_method, exit_metric, exit_multiple, normalized_ebitda_margin, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_key) DO UPDATE SET
      base_period = excluded.base_period,
      normalized_fcf_margin = excluded.normalized_fcf_margin,
      discount_rate = excluded.discount_rate,
      terminal_growth = excluded.terminal_growth,
      terminal_method = excluded.terminal_method,
      exit_metric = excluded.exit_metric,
      exit_multiple = excluded.exit_multiple,
      normalized_ebitda_margin = excluded.normalized_ebitda_margin,
      updated_at = excluded.updated_at
  `).run(
    companyKey,
    cleanBasePeriod(input.basePeriod, cleanBasePeriod(current?.base_period, null)),
    cleanNumber(input.normalizedFcfMargin, current?.normalized_fcf_margin ?? null),
    cleanNumber(input.discountRate, current?.discount_rate ?? null),
    cleanNumber(input.terminalGrowth, current?.terminal_growth ?? null),
    cleanTerminalMethod(input.terminalMethod, cleanTerminalMethod(current?.terminal_method, null)),
    cleanExitMetric(input.exitMetric, cleanExitMetric(current?.exit_metric, null)),
    cleanNumber(input.exitMultiple, current?.exit_multiple ?? null),
    cleanNumber(input.normalizedEbitdaMargin, current?.normalized_ebitda_margin ?? null),
    now()
  );
  recomputeModels(db, [companyKey]);
}

export function backfillFallbacksFromCache(db: DatabaseSync): void {
  const rows = db.prepare(`
    SELECT
      c.company_key,
      f.latest_revenue,
      f.base_period_default,
      f.base_financials_json,
      f.historical_revenue_cagr_5y,
      f.normalized_fcf_margin_default,
      f.revenue_history_json,
      f.fcf_history_json,
      f.latest_revenue_source,
      f.normalized_fcf_margin_source,
      f.historical_revenue_cagr_5y_source,
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
      latest_revenue_source = COALESCE(?, latest_revenue_source),
      normalized_fcf_margin_source = COALESCE(?, normalized_fcf_margin_source),
      historical_revenue_cagr_5y_source = COALESCE(historical_revenue_cagr_5y_source, ?),
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
    const historySource = revenueHistory.length >= 6 ? "Standardized 5Y revenue history" : null;

    if (latestRevenue !== null || normalizedFcfMargin !== null) {
      update.run(
        latestRevenue,
        normalizedFcfMargin,
        latestRevenueSource,
        normalizedFcfMarginSource,
        historySource,
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
      price_to_sales, price_to_earnings, ev_to_ebitda, fcf_yield, as_of_date, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_key) DO UPDATE SET
      share_price = excluded.share_price,
      market_cap = excluded.market_cap,
      enterprise_value = excluded.enterprise_value,
      ev_to_revenue = excluded.ev_to_revenue,
      price_to_sales = excluded.price_to_sales,
      price_to_earnings = excluded.price_to_earnings,
      ev_to_ebitda = excluded.ev_to_ebitda,
      fcf_yield = excluded.fcf_yield,
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
    numberOrNull(values.ratio_ev_to_ebitda),
    numberOrNull(values.ratio_fcf_yield),
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
    basePeriodDefault: BasePeriod | null;
    baseFinancials: { ltm: FinancialBase | null; annual: FinancialBase | null };
    evBridge: EvBridge | null;
    normalizedFcfMarginDefault: number | null;
    terminalGrowthDefault: number | null;
    discountRateDefault: number | null;
    terminalMethodDefault: TerminalMethod | null;
    exitMetricDefault: ExitMetric | null;
    exitMultipleDefault: number | null;
    normalizedEbitdaMarginDefault: number | null;
    exitMultipleStats: ExitMultipleStat[];
    latestRevenueSource: string | null;
    normalizedFcfMarginSource: string | null;
    historicalRevenueCagr5ySource: string | null;
    exitMultipleSource: string | null;
    normalizedEbitdaMarginSource: string | null;
    revenueHistory: unknown[];
    fcfHistory: unknown[];
    sourceLinks: unknown[];
  }
): void {
  db.prepare(`
    INSERT INTO financial_snapshots (
      company_key, latest_revenue, latest_revenue_year, latest_revenue_report_date,
      historical_revenue_cagr_5y, base_period_default, base_financials_json, ev_bridge_json, normalized_fcf_margin_default, normalized_fcf_margin_source,
      latest_revenue_source, historical_revenue_cagr_5y_source,
      terminal_growth_default, discount_rate_default,
      terminal_method_default, exit_metric_default, exit_multiple_default, exit_multiple_source,
      normalized_ebitda_margin_default, normalized_ebitda_margin_source, exit_multiple_stats_json,
      revenue_history_json,
      fcf_history_json, source_links_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_key) DO UPDATE SET
      latest_revenue = excluded.latest_revenue,
      latest_revenue_year = excluded.latest_revenue_year,
      latest_revenue_report_date = excluded.latest_revenue_report_date,
      historical_revenue_cagr_5y = excluded.historical_revenue_cagr_5y,
      base_period_default = excluded.base_period_default,
      base_financials_json = excluded.base_financials_json,
      ev_bridge_json = excluded.ev_bridge_json,
      normalized_fcf_margin_default = excluded.normalized_fcf_margin_default,
      normalized_fcf_margin_source = excluded.normalized_fcf_margin_source,
      latest_revenue_source = excluded.latest_revenue_source,
      historical_revenue_cagr_5y_source = excluded.historical_revenue_cagr_5y_source,
      terminal_growth_default = excluded.terminal_growth_default,
      discount_rate_default = excluded.discount_rate_default,
      terminal_method_default = excluded.terminal_method_default,
      exit_metric_default = excluded.exit_metric_default,
      exit_multiple_default = excluded.exit_multiple_default,
      exit_multiple_source = excluded.exit_multiple_source,
      normalized_ebitda_margin_default = excluded.normalized_ebitda_margin_default,
      normalized_ebitda_margin_source = excluded.normalized_ebitda_margin_source,
      exit_multiple_stats_json = excluded.exit_multiple_stats_json,
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
    input.basePeriodDefault,
    JSON.stringify(input.baseFinancials),
    JSON.stringify(input.evBridge ?? {}),
    input.normalizedFcfMarginDefault,
    input.normalizedFcfMarginSource,
    input.latestRevenueSource,
    input.historicalRevenueCagr5ySource,
    input.terminalGrowthDefault,
    input.discountRateDefault,
    input.terminalMethodDefault,
    input.exitMetricDefault,
    input.exitMultipleDefault,
    input.exitMultipleSource,
    input.normalizedEbitdaMarginDefault,
    input.normalizedEbitdaMarginSource,
    JSON.stringify(input.exitMultipleStats ?? []),
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
      f.base_period_default,
      f.base_financials_json,
      f.historical_revenue_cagr_5y,
      COALESCE(a.base_period, f.base_period_default) AS base_period,
      COALESCE(a.normalized_fcf_margin, f.normalized_fcf_margin_default) AS normalized_fcf_margin,
      COALESCE(a.discount_rate, f.discount_rate_default) AS discount_rate,
      COALESCE(a.terminal_growth, f.terminal_growth_default) AS terminal_growth,
      COALESCE(a.terminal_method, f.terminal_method_default) AS terminal_method,
      COALESCE(a.exit_metric, f.exit_metric_default) AS exit_metric,
      COALESCE(a.exit_multiple, f.exit_multiple_default) AS exit_multiple,
      COALESCE(a.normalized_ebitda_margin, f.normalized_ebitda_margin_default) AS normalized_ebitda_margin
    FROM companies c
    LEFT JOIN market_snapshots m ON m.company_key = c.company_key
    LEFT JOIN financial_snapshots f ON f.company_key = c.company_key
    LEFT JOIN assumption_overrides a ON a.company_key = c.company_key
    WHERE c.company_key = ?
  `);
  const upsert = db.prepare(`
    INSERT INTO model_outputs (
      company_key, implied_revenue_cagr, cagr_gap,
      signal, model_grid_json, diagnostics_json, sensitivity_json, status, status_message, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_key) DO UPDATE SET
      implied_revenue_cagr = excluded.implied_revenue_cagr,
      cagr_gap = excluded.cagr_gap,
      signal = excluded.signal,
      model_grid_json = excluded.model_grid_json,
      diagnostics_json = excluded.diagnostics_json,
      sensitivity_json = excluded.sensitivity_json,
      status = excluded.status,
      status_message = excluded.status_message,
      updated_at = excluded.updated_at
  `);
  for (const companyKey of companyKeys) {
    const row = statement.get(companyKey) as Record<string, unknown> | undefined;
    if (!row) continue;
    const bases = parseBaseFinancials(stringOrUndefined(row.base_financials_json));
    const base = baseByPeriod(cleanBasePeriod(row.base_period, null), bases);
    const dcfInputs = {
      enterpriseValue: numberOrNull(row.enterprise_value),
      baseRevenue: numberOrNull(base?.revenue) ?? numberOrNull(row.latest_revenue),
      normalizedFcfMargin: numberOrNull(row.normalized_fcf_margin),
      discountRate: numberOrNull(row.discount_rate),
      terminalGrowth: numberOrNull(row.terminal_growth),
      historicalRevenueCagr5y: numberOrNull(row.historical_revenue_cagr_5y),
      terminalMethod: cleanTerminalMethod(row.terminal_method),
      exitMetric: cleanExitMetric(row.exit_metric),
      exitMultiple: numberOrNull(row.exit_multiple),
      normalizedEbitdaMargin: numberOrNull(row.normalized_ebitda_margin)
    };
    const output = buildModel(dcfInputs);
    const sensitivity = buildSensitivity(dcfInputs);
    upsert.run(
      companyKey,
      output.impliedRevenueCagr,
      output.cagrGap,
      output.signal,
      JSON.stringify(output.gridRows),
      JSON.stringify(output.diagnostics),
      JSON.stringify(sensitivity),
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
      m.share_price, m.market_cap, m.enterprise_value, m.ev_to_revenue, m.updated_at AS prices_updated_at,
      f.latest_revenue, f.historical_revenue_cagr_5y, f.base_period_default, f.base_financials_json, f.ev_bridge_json,
      f.normalized_fcf_margin_default, f.normalized_fcf_margin_source, f.latest_revenue_source, f.historical_revenue_cagr_5y_source,
      f.discount_rate_default, f.terminal_growth_default,
      f.terminal_method_default, f.exit_metric_default, f.exit_multiple_default, f.exit_multiple_source,
      f.normalized_ebitda_margin_default, f.normalized_ebitda_margin_source,
      f.updated_at AS financials_updated_at,
      a.base_period AS override_base_period,
      a.normalized_fcf_margin AS override_margin,
      a.discount_rate AS override_discount_rate,
      a.terminal_growth AS override_terminal_growth,
      a.terminal_method AS override_terminal_method,
      a.exit_metric AS override_exit_metric,
      a.exit_multiple AS override_exit_multiple,
      a.normalized_ebitda_margin AS override_normalized_ebitda_margin,
      o.implied_revenue_cagr, o.cagr_gap, o.signal,
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
  const basePeriod = cleanBasePeriod(row.override_base_period, cleanBasePeriod(row.base_period_default, null));
  const bases = parseBaseFinancials(row.base_financials_json ?? undefined);
  const selectedBase = baseByPeriod(basePeriod, bases);
  const discountRate = row.override_discount_rate ?? row.discount_rate_default;
  const terminalGrowth = row.override_terminal_growth ?? row.terminal_growth_default;
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
    latestRevenue: numberOrNull(selectedBase?.revenue) ?? numberOrNull(row.latest_revenue),
    evToRevenue: numberOrNull(row.ev_to_revenue),
    historicalRevenueCagr5y: numberOrNull(row.historical_revenue_cagr_5y),
    normalizedFcfMargin: numberOrNull(normalizedFcfMargin),
    discountRate: numberOrNull(discountRate),
    terminalGrowth: numberOrNull(terminalGrowth),
    latestRevenueSource: selectedBase?.source ?? row.latest_revenue_source,
    normalizedFcfMarginSource: row.override_margin !== null ? "User override" : row.normalized_fcf_margin_source,
    historicalRevenueCagrSource: row.historical_revenue_cagr_5y_source,
    impliedRevenueCagr: numberOrNull(row.implied_revenue_cagr),
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
    latestRevenue: baseByPeriod(cleanBasePeriod(row.override_base_period, cleanBasePeriod(row.base_period_default, null)), parseBaseFinancials(row.base_financials_json ?? undefined))?.source ?? row.latest_revenue_source,
    normalizedFcfMargin: row.override_margin !== null ? "User override" : row.normalized_fcf_margin_source,
    historicalRevenueCagr5y: row.historical_revenue_cagr_5y_source,
    normalizedEbitdaMargin: row.override_normalized_ebitda_margin !== null ? "User override" : row.normalized_ebitda_margin_source,
    exitMultiple: row.override_exit_multiple !== null ? "User override" : row.exit_multiple_source
  };
}

function getAssumptionDefaults(row: JoinedCompany): AssumptionSet {
  return {
    basePeriod: cleanBasePeriod(row.base_period_default, null),
    normalizedFcfMargin: numberOrNull(row.normalized_fcf_margin_default),
    discountRate: numberOrNull(row.discount_rate_default),
    terminalGrowth: numberOrNull(row.terminal_growth_default),
    terminalMethod: cleanTerminalMethod(row.terminal_method_default, "perpetuity"),
    exitMetric: cleanExitMetric(row.exit_metric_default, "fcf"),
    exitMultiple: numberOrNull(row.exit_multiple_default),
    normalizedEbitdaMargin: numberOrNull(row.normalized_ebitda_margin_default)
  };
}

function getAssumptionOverrides(row: JoinedCompany): AssumptionSet {
  return {
    basePeriod: cleanBasePeriod(row.override_base_period, null),
    normalizedFcfMargin: numberOrNull(row.override_margin),
    discountRate: numberOrNull(row.override_discount_rate),
    terminalGrowth: numberOrNull(row.override_terminal_growth),
    terminalMethod: cleanTerminalMethod(row.override_terminal_method, null),
    exitMetric: cleanExitMetric(row.override_exit_metric, null),
    exitMultiple: numberOrNull(row.override_exit_multiple),
    normalizedEbitdaMargin: numberOrNull(row.override_normalized_ebitda_margin)
  };
}



function buildCurrentEvBridge(cached: Partial<EvBridge>, marketCap: number | null, fiscalEnterpriseValue: number | null): EvBridge | null {
  if (!cached || Object.keys(cached).length === 0) return marketCap !== null || fiscalEnterpriseValue !== null ? {
    marketCap, cash: null, debt: null, leases: null, preferredStock: null, minorityInterest: null, netDebt: null,
    fiscalEnterpriseValue, rebuiltEnterpriseValue: null, difference: null, differencePercent: null, warning: null, asOfDate: null, source: null
  } : null;
  const cash = numberOrNull(cached.cash);
  const debt = numberOrNull(cached.debt);
  const leases = numberOrNull(cached.leases);
  const preferredStock = numberOrNull(cached.preferredStock);
  const minorityInterest = numberOrNull(cached.minorityInterest);
  const effectiveMarketCap = marketCap ?? numberOrNull(cached.marketCap);
  const effectiveFiscalEv = fiscalEnterpriseValue ?? numberOrNull(cached.fiscalEnterpriseValue);
  const netDebt = debt !== null || leases !== null || cash !== null ? (debt ?? 0) + (leases ?? 0) - (cash ?? 0) : null;
  const rebuiltEnterpriseValue = effectiveMarketCap !== null
    ? effectiveMarketCap + (debt ?? 0) + (leases ?? 0) + (preferredStock ?? 0) + (minorityInterest ?? 0) - (cash ?? 0)
    : null;
  const difference = rebuiltEnterpriseValue !== null && effectiveFiscalEv !== null ? rebuiltEnterpriseValue - effectiveFiscalEv : null;
  const differencePercent = difference !== null && effectiveFiscalEv && effectiveFiscalEv > 0 ? difference / effectiveFiscalEv : null;
  return {
    marketCap: effectiveMarketCap,
    cash,
    debt,
    leases,
    preferredStock,
    minorityInterest,
    netDebt,
    fiscalEnterpriseValue: effectiveFiscalEv,
    rebuiltEnterpriseValue,
    difference,
    differencePercent,
    warning: Math.abs(differencePercent ?? 0) > 0.05 ? "Rebuilt EV differs materially from Fiscal calculated TEV." : null,
    asOfDate: nullableString(cached.asOfDate),
    source: nullableString(cached.source)
  };
}

function parseBaseFinancials(value: string | null | undefined): { ltm: FinancialBase | null; annual: FinancialBase | null } {
  const parsed = parseJson<Partial<Record<BasePeriod, FinancialBase>>>(value ?? undefined, {});
  return {
    ltm: normalizeBase(parsed.ltm, "ltm"),
    annual: normalizeBase(parsed.annual, "annual")
  };
}

function normalizeBase(base: FinancialBase | undefined, period: BasePeriod): FinancialBase | null {
  if (!base) return null;
  return {
    period,
    label: typeof base.label === "string" ? base.label : period === "ltm" ? "LTM" : "Latest Annual",
    revenue: numberOrNull(base.revenue),
    fcf: numberOrNull(base.fcf),
    fcfMargin: numberOrNull(base.fcfMargin),
    reportDate: nullableString(base.reportDate),
    source: nullableString(base.source)
  };
}

function selectBasePeriod(period: BasePeriod | null, bases: { ltm: FinancialBase | null; annual: FinancialBase | null }): BasePeriod | null {
  if (period && baseByPeriod(period, bases)) return period;
  if (bases.ltm) return "ltm";
  if (bases.annual) return "annual";
  return null;
}

function baseByPeriod(period: BasePeriod | null, bases: { ltm: FinancialBase | null; annual: FinancialBase | null }): FinancialBase | null {
  if (period === "ltm") return bases.ltm;
  if (period === "annual") return bases.annual;
  return bases.ltm ?? bases.annual;
}

function cleanBasePeriod(value: unknown, fallback: BasePeriod | null): BasePeriod | null {
  return value === "ltm" || value === "annual" ? value : fallback;
}

function cleanTerminalMethod(value: unknown, fallback: TerminalMethod | null = null): TerminalMethod | null {
  return value === "perpetuity" || value === "exit-multiple" ? value : fallback;
}

function cleanExitMetric(value: unknown, fallback: ExitMetric | null = null): ExitMetric | null {
  return value === "fcf" || value === "ebitda" || value === "revenue" ? value : fallback;
}

function markOverrides(rows: ModelCell[], overrides: AssumptionSet): ModelCell[] {
  const labels: Record<string, keyof AssumptionSet> = {
    "Base period": "basePeriod",
    "Normalized FCF margin": "normalizedFcfMargin",
    "Discount rate": "discountRate",
    "Terminal growth": "terminalGrowth",
    "EBITDA margin": "normalizedEbitdaMargin"
  };
  return rows.map((row) => {
    const overrideKey = row.label.startsWith("Exit multiple") ? "exitMultiple" : labels[row.label];
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
  current_pe: number | null;
  current_ev_sales: number | null;
  current_ev_ebitda: number | null;
  current_price_sales: number | null;
  current_fcf_yield: number | null;
  market_updated_at: string | null;
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

export function upsertDailyEvHistory(
  db: DatabaseSync,
  companyKey: string,
  evPoints: Array<{ date: string; enterpriseValue: number | null }>,
  pricePoints: Array<{ date: string; sharePrice: number | null }>
): void {
  const priceByDate = new Map(pricePoints.map((point) => [point.date, point.sharePrice]));
  const upsert = db.prepare(`
    INSERT INTO daily_ev_history (company_key, date, enterprise_value, share_price)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(company_key, date) DO UPDATE SET
      enterprise_value = excluded.enterprise_value,
      share_price = excluded.share_price
  `);
  const seenDates = new Set<string>();
  for (const point of evPoints) {
    const date = String(point.date).slice(0, 10);
    if (!date || seenDates.has(date)) continue;
    seenDates.add(date);
    upsert.run(companyKey, date, numberOrNull(point.enterpriseValue), numberOrNull(priceByDate.get(date)));
  }
  for (const [date, sharePrice] of priceByDate) {
    const dateStr = String(date).slice(0, 10);
    if (!dateStr || seenDates.has(dateStr)) continue;
    seenDates.add(dateStr);
    upsert.run(companyKey, dateStr, null, numberOrNull(sharePrice));
  }
}

export function getImpliedGrowthHistoryData(db: DatabaseSync, companyKey: string): ImpliedGrowthHistoryData | null {
  const evRows = db.prepare(`
    SELECT date, enterprise_value, share_price
    FROM daily_ev_history
    WHERE company_key = ? AND date IS NOT NULL
    ORDER BY date ASC
  `).all(companyKey) as Array<{ date: string; enterprise_value: number | null; share_price: number | null }>;

  const financialRow = db.prepare(`
    SELECT revenue_history_json FROM financial_snapshots WHERE company_key = ?
  `).get(companyKey) as { revenue_history_json?: string } | undefined;

  const revenueHistory = parseJson<Array<{ year: number; value: number; reportDate: string }>>(
    financialRow?.revenue_history_json,
    []
  );
  const revenueTimeline = revenueHistory
    .filter((point) => Number.isFinite(point.value) && point.value > 0)
    .map((point) => ({ reportDate: point.reportDate, revenue: point.value }));

  const dailyEv: DailyEvPoint[] = evRows.map((row) => ({
    date: row.date,
    enterpriseValue: numberOrNull(row.enterprise_value),
    sharePrice: numberOrNull(row.share_price)
  }));

  const realizedGrowth = computeRealizedGrowth(revenueTimeline) as RealizedGrowthPoint[];

  if (dailyEv.length === 0 && revenueTimeline.length === 0) return null;

  const dates = dailyEv.map((point) => point.date).sort();
  const earliestDate = dates[0] ?? null;
  const latestDate = dates[dates.length - 1] ?? null;
  let maxHistoryYears = 0;
  if (earliestDate && latestDate) {
    const earliest = new Date(earliestDate + "T00:00:00.000Z");
    const latest = new Date(latestDate + "T00:00:00.000Z");
    maxHistoryYears = (latest.getTime() - earliest.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  }

  return {
    dailyEv,
    revenueTimeline,
    realizedGrowth,
    maxHistoryYears,
    earliestDate,
    latestDate
  };
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
      m.share_price, m.price_to_earnings AS current_pe, m.ev_to_revenue AS current_ev_sales,
      m.ev_to_ebitda AS current_ev_ebitda, m.price_to_sales AS current_price_sales,
      m.fcf_yield AS current_fcf_yield, m.updated_at AS market_updated_at,
      v.metrics_json, v.pe_history_json, v.pe_band_levels_json, v.updated_at AS valuation_updated_at,
      u.is_favorite, u.note
    FROM companies c
    LEFT JOIN market_snapshots m ON m.company_key = c.company_key
    LEFT JOIN valuation_snapshots v ON v.company_key = c.company_key
    LEFT JOIN user_company_state u ON u.company_key = c.company_key
  `;
}

function toValuationRow(row: ValuationJoined): ValuationRow {
  const metrics = completeMetrics(parseJson<Partial<Record<ValuationMetricKey, ValuationMetricStats>>>(row.metrics_json, {}), row);
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
    valuationUpdatedAt: row.valuation_updated_at ?? row.market_updated_at
  };
}

function completeMetrics(input: Partial<Record<ValuationMetricKey, ValuationMetricStats>>, row: ValuationJoined): Record<ValuationMetricKey, ValuationMetricStats> {
  return Object.fromEntries(VALUATION_RATIOS.map((config) => [config.key, input[config.key] ?? emptyMetric(config, currentMetricFallback(row, config.key))])) as Record<ValuationMetricKey, ValuationMetricStats>;
}

function currentMetricFallback(row: ValuationJoined, key: ValuationMetricKey): number | null {
  switch (key) {
    case "pe":
      return numberOrNull(row.current_pe);
    case "evSales":
      return numberOrNull(row.current_ev_sales);
    case "evEbitda":
      return numberOrNull(row.current_ev_ebitda);
    case "priceSales":
      return numberOrNull(row.current_price_sales);
    case "fcfYield":
      return numberOrNull(row.current_fcf_yield);
  }
}

function emptyMetric(config: (typeof VALUATION_RATIOS)[number], current: number | null = null): ValuationMetricStats {
  return {
    key: config.key,
    label: config.label,
    ratioId: config.ratioId,
    current,
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
