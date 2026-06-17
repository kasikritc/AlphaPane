import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDownUp, ChevronDown, Columns3, DatabaseZap, RefreshCw, Search, Star } from "lucide-react";
import type {
  BasePeriod,
  ColumnPreference,
  CompanyDetail,
  CompanyRow,
  DashboardTab,
  ExitMetric,
  ModelCell,
  ModelDiagnostics,
  RefreshRun,
  SensitivityTable,
  TerminalMethod,
  ValuationDetail,
  ValuationHistoryPoint,
  ValuationMetricStats,
  ValuationRow
} from "@alphapane/shared";

interface BaseRow {
  companyKey: string;
  ticker: string;
  name: string;
  sector: string | null;
  isFavorite: boolean;
  note: string;
}

interface RefreshPayload {
  rows: CompanyRow[];
  valuationRows?: ValuationRow[];
  runs: RefreshRun[];
}

interface TableColumn<Row extends BaseRow> {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  render: (row: Row) => string | ReactNode;
  sortValue?: (row: Row) => string | number | null | boolean;
}

const reverseColumns: TableColumn<CompanyRow>[] = [
  { key: "actions", label: "", align: "center", render: (row) => <FavoriteButton row={row} /> },
  { key: "ticker", label: "Ticker", render: (row) => row.ticker, sortValue: (row) => row.ticker },
  { key: "name", label: "Company", render: (row) => row.name, sortValue: (row) => row.name },
  { key: "sector", label: "Sector", render: (row) => row.sector ?? "-", sortValue: (row) => row.sector },
  { key: "sharePrice", label: "Price", align: "right", render: (row) => money(row.sharePrice), sortValue: (row) => row.sharePrice },
  { key: "enterpriseValue", label: "EV", align: "right", render: (row) => compactMoney(row.enterpriseValue), sortValue: (row) => row.enterpriseValue },
  { key: "latestRevenue", label: "Revenue", align: "right", render: (row) => compactMoney(row.latestRevenue), sortValue: (row) => row.latestRevenue },
  { key: "evToRevenue", label: "EV/Rev", align: "right", render: (row) => multiple(row.evToRevenue), sortValue: (row) => row.evToRevenue },
  { key: "historicalRevenueCagr5y", label: "Hist 5Y CAGR", align: "right", render: (row) => percent(row.historicalRevenueCagr5y), sortValue: (row) => row.historicalRevenueCagr5y },
  { key: "normalizedFcfMargin", label: "FCF Margin", align: "right", render: (row) => percent(row.normalizedFcfMargin), sortValue: (row) => row.normalizedFcfMargin },
  { key: "discountRate", label: "Discount", align: "right", render: (row) => percent(row.discountRate), sortValue: (row) => row.discountRate },
  { key: "terminalGrowth", label: "Terminal", align: "right", render: (row) => percent(row.terminalGrowth), sortValue: (row) => row.terminalGrowth },
  { key: "impliedRevenueCagr", label: "Priced-In CAGR", align: "right", render: (row) => strong(percent(row.impliedRevenueCagr)), sortValue: (row) => row.impliedRevenueCagr },
  { key: "cagrGap", label: "Gap", align: "right", render: (row) => percent(row.cagrGap), sortValue: (row) => row.cagrGap },
  { key: "signal", label: "Signal", render: (row) => <SignalPill signal={row.signal} />, sortValue: (row) => row.signal },
  { key: "financialsUpdatedAt", label: "Financials", render: (row) => dateShort(row.financialsUpdatedAt), sortValue: (row) => row.financialsUpdatedAt },
  { key: "pricesUpdatedAt", label: "Market", render: (row) => dateShort(row.pricesUpdatedAt), sortValue: (row) => row.pricesUpdatedAt },
  { key: "note", label: "Note", render: (row) => (row.note.trim() ? "Yes" : "-"), sortValue: (row) => row.note }
];

const valuationColumns: TableColumn<ValuationRow>[] = [
  { key: "actions", label: "", align: "center", render: (row) => <FavoriteButton row={row} /> },
  { key: "ticker", label: "Ticker", render: (row) => row.ticker, sortValue: (row) => row.ticker },
  { key: "name", label: "Company", render: (row) => row.name, sortValue: (row) => row.name },
  { key: "sector", label: "Sector", render: (row) => row.sector ?? "-", sortValue: (row) => row.sector },
  { key: "sharePrice", label: "Price", align: "right", render: (row) => money(row.sharePrice), sortValue: (row) => row.sharePrice },
  { key: "peZ", label: "P/E Z", align: "right", render: (row) => zScore(row.pe.zScore), sortValue: (row) => row.pe.zScore },
  { key: "pe", label: "P/E", align: "right", render: (row) => multiple(row.pe.current), sortValue: (row) => row.pe.current },
  { key: "peMean", label: "P/E Mean", align: "right", render: (row) => multiple(row.pe.mean), sortValue: (row) => row.pe.mean },
  { key: "pePercentile", label: "P/E Percentile", align: "right", render: (row) => percent(row.pe.percentileRank), sortValue: (row) => row.pe.percentileRank },
  { key: "evSales", label: "EV/Sales Z", align: "right", render: (row) => zScore(row.evSales.zScore), sortValue: (row) => row.evSales.zScore },
  { key: "evEbitda", label: "EV/EBITDA Z", align: "right", render: (row) => zScore(row.evEbitda.zScore), sortValue: (row) => row.evEbitda.zScore },
  { key: "priceSales", label: "P/S Z", align: "right", render: (row) => zScore(row.priceSales.zScore), sortValue: (row) => row.priceSales.zScore },
  { key: "fcfYield", label: "FCF Yield Z", align: "right", render: (row) => zScore(row.fcfYield.zScore), sortValue: (row) => row.fcfYield.zScore },
  { key: "observations", label: "Obs", align: "right", render: (row) => String(row.pe.observationCount), sortValue: (row) => row.pe.observationCount },
  { key: "valuationUpdatedAt", label: "Valuation", render: (row) => dateShort(row.valuationUpdatedAt), sortValue: (row) => row.valuationUpdatedAt },
  { key: "note", label: "Note", render: (row) => (row.note.trim() ? "Yes" : "-"), sortValue: (row) => row.note }
];

export function App() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("reverseDcf");
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [valuationRows, setValuationRows] = useState<ValuationRow[]>([]);
  const [preferences, setPreferences] = useState<ColumnPreference[]>([]);
  const [valuationPreferences, setValuationPreferences] = useState<ColumnPreference[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [valuationDetail, setValuationDetail] = useState<ValuationDetail | null>(null);
  const [runs, setRuns] = useState<RefreshRun[]>([]);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortKey, setSortKey] = useState<string>("impliedRevenueCagr");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    setSortKey(activeTab === "reverseDcf" ? "impliedRevenueCagr" : "peZ");
    setSortDirection("asc");
  }, [activeTab]);

  useEffect(() => {
    if (!selectedKey) {
      setDetail(null);
      setValuationDetail(null);
      return;
    }
    if (activeTab === "reverseDcf") void loadDetail(selectedKey);
    else void loadValuationDetail(selectedKey);
  }, [selectedKey, activeTab]);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const [reversePayload, valuationPayload, refreshPayload] = await Promise.all([
        api<{ rows: CompanyRow[]; columns: ColumnPreference[] }>("/api/companies"),
        api<{ rows: ValuationRow[]; columns: ColumnPreference[] }>("/api/valuation/companies"),
        api<{ runs: RefreshRun[] }>("/api/refresh-runs")
      ]);
      setRows(reversePayload.rows);
      setPreferences(reversePayload.columns);
      setValuationRows(valuationPayload.rows);
      setValuationPreferences(valuationPayload.columns);
      setRuns(refreshPayload.runs);
      if (!selectedKey) setSelectedKey(reversePayload.rows[0]?.companyKey ?? valuationPayload.rows[0]?.companyKey ?? null);
    } catch (apiError) {
      setError(errorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(companyKey: string) {
    try {
      setDetail(await api<CompanyDetail>(`/api/companies/${companyKey}`));
    } catch (apiError) {
      setError(errorMessage(apiError));
    }
  }

  async function loadValuationDetail(companyKey: string) {
    try {
      setValuationDetail(await api<ValuationDetail>(`/api/valuation/companies/${companyKey}`));
    } catch (apiError) {
      setError(errorMessage(apiError));
    }
  }

  function applyRefreshPayload(payload: RefreshPayload) {
    setRows(payload.rows);
    if (payload.valuationRows) setValuationRows(payload.valuationRows);
    setRuns(payload.runs);
  }

  async function runRefresh(kind: "all" | "prices" | "financials") {
    setRefreshing(kind);
    setError(null);
    try {
      if (kind === "all") {
        setRefreshStatus("Refreshing financials…");
        applyRefreshPayload(await api<RefreshPayload>("/api/refresh/financials", { method: "POST" }));
        setRefreshStatus("Refreshing market & valuation…");
        applyRefreshPayload(await api<RefreshPayload>("/api/refresh/prices", { method: "POST" }));
      } else {
        applyRefreshPayload(await api<RefreshPayload>(`/api/refresh/${kind}`, { method: "POST" }));
      }
      if (selectedKey) {
        if (activeTab === "reverseDcf") await loadDetail(selectedKey);
        else await loadValuationDetail(selectedKey);
      }
    } catch (apiError) {
      setError(errorMessage(apiError));
      const refreshPayload = await api<{ runs: RefreshRun[] }>("/api/refresh-runs");
      setRuns(refreshPayload.runs);
    } finally {
      setRefreshing(null);
      setRefreshStatus(null);
    }
  }

  const reverseFreshness = useMemo(() => {
    const latest = latestDate(rows.flatMap((row) => [row.financialsUpdatedAt, row.pricesUpdatedAt]));
    return latest ? `Data as of ${dateShort(latest)}` : "No data cached yet — click Refresh data";
  }, [rows]);
  const valuationFreshness = useMemo(() => {
    const latest = latestDate(valuationRows.map((row) => row.valuationUpdatedAt));
    return latest ? `Valuation data as of ${dateShort(latest)}` : "No valuation data cached yet — click Refresh data";
  }, [valuationRows]);

  const reverseTable = useTable(rows, reverseColumns, preferences, query, favoritesOnly, sortKey, sortDirection);
  const valuationTable = useTable(valuationRows, valuationColumns, valuationPreferences, query, favoritesOnly, sortKey, sortDirection);

  const table = activeTab === "reverseDcf" ? reverseTable : valuationTable;
  const tableColumns = activeTab === "reverseDcf" ? reverseColumns : valuationColumns;
  const currentPreferences = activeTab === "reverseDcf" ? preferences : valuationPreferences;
  const setCurrentPreferences = activeTab === "reverseDcf" ? setPreferences : setValuationPreferences;

  async function toggleColumn(key: string) {
    const hidden = new Set(currentPreferences.filter((pref) => pref.visible === false).map((pref) => pref.key));
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    const next = tableColumns.filter((column) => column.key !== "actions").map((column) => ({ key: column.key, visible: !hidden.has(column.key) }));
    setCurrentPreferences(next);
    await api("/api/preferences/columns", {
      method: "PATCH",
      body: JSON.stringify({ columns: next, key: activeTab === "reverseDcf" ? "reverseDcfColumns" : "historicalValuationColumns" })
    });
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <h1>AlphaPane</h1>
          <p>AlphaPane market scanner for reverse DCF and historical valuation mean reversion.</p>
        </div>
        <div className="actions">
          <button className="primary-refresh" onClick={() => void runRefresh("all")} disabled={Boolean(refreshing)}>
            <RefreshCw size={16} className={refreshing ? "spin" : undefined} />
            {refreshing ? refreshStatus ?? "Refreshing…" : "Refresh data"}
          </button>
          <details className="refresh-menu">
            <summary aria-label="Advanced refresh options"><ChevronDown size={16} /></summary>
            <div>
              <button onClick={() => void runRefresh("prices")} disabled={Boolean(refreshing)}>
                <RefreshCw size={15} />
                <span><strong>Market &amp; valuation only</strong><small>Price, EV, current multiples, P/E z-scores &amp; σ-bands</small></span>
              </button>
              <button onClick={() => void runRefresh("financials")} disabled={Boolean(refreshing)}>
                <DatabaseZap size={15} />
                <span><strong>Financials &amp; DCF only</strong><small>Profile, revenue/FCF history, DCF default assumptions</small></span>
              </button>
            </div>
          </details>
        </div>
      </header>

      <nav className="tabs" aria-label="Scanner views">
        <button className={activeTab === "reverseDcf" ? "active" : ""} onClick={() => setActiveTab("reverseDcf")}>Reverse DCF</button>
        <button className={activeTab === "historicalValuation" ? "active" : ""} onClick={() => setActiveTab("historicalValuation")}>Historical Valuation</button>
      </nav>

      {error && <div className="error">{error}</div>}

      <main className="layout with-tabs">
        <section className="table-section">
          <div className="toolbar">
            <label className="search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticker, company, sector" />
            </label>
            <label className="check">
              <input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />
              Favorites
            </label>
            <span className="freshness" title="Click Refresh data to fetch the latest figures from Fiscal.ai">
              {activeTab === "reverseDcf" ? reverseFreshness : valuationFreshness}
            </span>
            <details className="columns-menu">
              <summary><Columns3 size={16} /> Columns</summary>
              <div>
                {tableColumns.filter((column) => column.key !== "actions").map((column) => (
                  <label key={column.key}>
                    <input type="checkbox" checked={!table.hiddenKeys.has(column.key)} onChange={() => void toggleColumn(column.key)} />
                    {column.label}
                  </label>
                ))}
              </div>
            </details>
          </div>

          {activeTab === "reverseDcf" ? (
            <DataTable<CompanyRow>
              rows={reverseTable.filteredRows}
              columns={reverseTable.visibleColumns}
              loading={loading}
              selectedKey={selectedKey}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={(key) => {
                if (sortKey === key) setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                else setSortKey(key);
              }}
              onSelect={setSelectedKey}
            />
          ) : (
            <DataTable<ValuationRow>
              rows={valuationTable.filteredRows}
              columns={valuationTable.visibleColumns}
              loading={loading}
              selectedKey={selectedKey}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={(key) => {
                if (sortKey === key) setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                else setSortKey(key);
              }}
              onSelect={setSelectedKey}
            />
          )}
        </section>

        <aside className="detail-panel">
          {activeTab === "reverseDcf" ? (
            detail ? <ReverseDcfDetailView detail={detail} onSaved={loadDashboard} /> : <EmptyDetail runs={runs} label="reverse DCF model grid" />
          ) : valuationDetail ? (
            <ValuationDetailView detail={valuationDetail} onSaved={loadDashboard} />
          ) : (
            <EmptyDetail runs={runs} label="historical valuation chart" />
          )}
        </aside>
      </main>
    </div>
  );
}

function useTable<Row extends BaseRow>(
  rows: Row[],
  columns: TableColumn<Row>[],
  preferences: ColumnPreference[],
  query: string,
  favoritesOnly: boolean,
  sortKey: string,
  sortDirection: "asc" | "desc"
) {
  const hiddenKeys = useMemo(() => new Set(preferences.filter((pref) => pref.visible === false).map((pref) => pref.key)), [preferences]);
  const visibleColumns = useMemo(() => columns.filter((column) => column.key === "actions" || !hiddenKeys.has(column.key)), [columns, hiddenKeys]);
  const filteredRows = useMemo(() => {
    const text = query.trim().toLowerCase();
    const column = columns.find((item) => item.key === sortKey);
    return rows
      .filter((row) => !favoritesOnly || row.isFavorite)
      .filter((row) => !text || `${row.ticker} ${row.name} ${row.sector ?? ""}`.toLowerCase().includes(text))
      .sort((a, b) => compareValues(column?.sortValue?.(a) ?? null, column?.sortValue?.(b) ?? null, sortDirection));
  }, [rows, query, favoritesOnly, sortKey, sortDirection, columns]);
  return { hiddenKeys, visibleColumns, filteredRows };
}

function DataTable<Row extends BaseRow>({ rows, columns, loading, selectedKey, sortKey, sortDirection, onSort, onSelect }: {
  rows: Row[];
  columns: TableColumn<Row>[];
  loading: boolean;
  selectedKey: string | null;
  sortKey: string;
  sortDirection: "asc" | "desc";
  onSort: (key: string) => void;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align ?? "left"}>
                <div className={`th-inner ${column.align ?? "left"}`}>
                  <button className="sort-button" onClick={() => column.key !== "actions" && onSort(column.key)}>
                    {column.label}
                    {column.key !== "actions" && <ArrowDownUp size={12} />}
                    {sortKey === column.key && <span className="sort-mark">{sortDirection === "asc" ? "Asc" : "Desc"}</span>}
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={columns.length}>Loading local cache...</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={columns.length}>No companies match the current filters.</td></tr>
          ) : rows.map((row) => (
            <tr key={row.companyKey} className={selectedKey === row.companyKey ? "selected" : ""} onClick={() => onSelect(row.companyKey)}>
              {columns.map((column) => <td key={column.key} className={column.align ?? "left"}>{column.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReverseDcfDetailView({ detail, onSaved }: { detail: CompanyDetail; onSaved: () => Promise<void> }) {
  const [note, setNote] = useState(detail.row.note);
  const [assumptions, setAssumptions] = useState(() => initialAssumptions(detail));

  useEffect(() => {
    setNote(detail.row.note);
    setAssumptions(initialAssumptions(detail));
  }, [detail]);

  const isExitMode = assumptions.terminalMethod === "exit-multiple";

  async function saveNote() {
    await api(`/api/companies/${detail.row.companyKey}/state`, { method: "PATCH", body: JSON.stringify({ note }) });
    await onSaved();
  }

  async function saveAssumptions() {
    await api(`/api/companies/${detail.row.companyKey}/assumptions`, { method: "PATCH", body: JSON.stringify(assumptions) });
    await onSaved();
  }

  return (
    <>
      <div className="detail-header"><div><h2>{detail.row.ticker}</h2><p>{detail.row.name}</p></div><SignalPill signal={detail.row.signal} /></div>
      {detail.row.caution && <div className="caution">{detail.row.caution}</div>}
      <div className="metrics-strip">
        <Metric label="Priced-In CAGR" value={percent(detail.row.impliedRevenueCagr)} />
        <Metric label="History" value={percent(detail.row.historicalRevenueCagr5y)} />
        <Metric label="Gap" value={percent(detail.row.cagrGap)} />
        <Metric label="EV/Rev" value={multiple(detail.row.evToRevenue)} />
      </div>
      {isExitMode && Number.isFinite(detail.row.impliedRevenueCagr) && (
        <p className="headline-note">Priced-in CAGR using {multiple(assumptions.exitMultiple)} terminal {exitMetricLabel(assumptions.exitMetric)} multiple: {percent(detail.row.impliedRevenueCagr)}</p>
      )}
      <section className="section">
        <h3>Base Financials</h3>
        <div className="assumption-grid">
          <label>Base period
            <select value={assumptions.basePeriod ?? ""} onChange={(event) => setAssumptions({ ...assumptions, basePeriod: parseBasePeriod(event.target.value) })}>
              <option value="" disabled>Select base</option>
              <option value="ltm" disabled={!detail.baseFinancials.ltm}>LTM</option>
              <option value="annual" disabled={!detail.baseFinancials.annual}>Latest Annual</option>
            </select>
          </label>
        </div>
        <BaseFinancialsTable detail={detail} selected={assumptions.basePeriod} />
      </section>
      <EvBridgeSection detail={detail} />
      <section className="section">
        <h3>Assumptions</h3>
        <div className="assumption-grid">
          <InputPercent label="FCF margin" value={assumptions.normalizedFcfMargin} onChange={(value) => setAssumptions({ ...assumptions, normalizedFcfMargin: value })} />
          <InputPercent label="Discount rate" value={assumptions.discountRate} onChange={(value) => setAssumptions({ ...assumptions, discountRate: value })} />
          <label>Terminal method
            <select value={assumptions.terminalMethod} onChange={(event) => setAssumptions({ ...assumptions, terminalMethod: parseTerminalMethod(event.target.value) })}>
              <option value="perpetuity">Perpetuity Growth</option>
              <option value="exit-multiple">Exit Multiple</option>
            </select>
          </label>
          {!isExitMode && (
            <InputPercent label="Terminal growth" value={assumptions.terminalGrowth} onChange={(value) => setAssumptions({ ...assumptions, terminalGrowth: value })} />
          )}
          {isExitMode && (
            <label>Exit metric
              <select value={assumptions.exitMetric} onChange={(event) => setAssumptions({ ...assumptions, exitMetric: parseExitMetric(event.target.value) })}>
                <option value="fcf">FCF</option>
                <option value="ebitda">EBITDA</option>
                <option value="revenue">Revenue</option>
              </select>
            </label>
          )}
          {isExitMode && (
            <InputNumber label="Exit multiple" value={assumptions.exitMultiple} onChange={(value) => setAssumptions({ ...assumptions, exitMultiple: value })} />
          )}
          {isExitMode && assumptions.exitMetric === "ebitda" && (
            <InputPercent label="EBITDA margin" value={assumptions.normalizedEbitdaMargin} onChange={(value) => setAssumptions({ ...assumptions, normalizedEbitdaMargin: value })} />
          )}
        </div>
        {isExitMode && <ExitMultipleStatsTable detail={detail} metric={assumptions.exitMetric} />}
        <button className="primary-action" onClick={() => void saveAssumptions()}>Save assumptions</button>
      </section>
      <section className="section"><h3>Default Sources</h3><div className="source-grid"><Metric label="Revenue" value={detail.sources.latestRevenue ?? "-"} /><Metric label="FCF margin" value={detail.sources.normalizedFcfMargin ?? "-"} /><Metric label="History CAGR" value={detail.sources.historicalRevenueCagr5y ?? "-"} /></div></section>
      <section className="section"><h3>Model Grid</h3><ModelGrid detail={detail} /></section>
      <ModelDiagnosticsSection detail={detail} />
      <SensitivitySection tables={detail.sensitivity} />
      <NoteSection note={note} setNote={setNote} saveNote={saveNote} />
      <SourcesSection links={detail.sourceLinks} terminalUrl={detail.row.terminalUrl} />
    </>
  );
}



function ModelDiagnosticsSection({ detail }: { detail: CompanyDetail }) {
  const d = detail.diagnostics;
  if (!d) return null;
  return (
    <section className="section">
      <h3>Model Diagnostics</h3>
      {d.statusMessage && <div className={d.solveStatus === "ok" ? "inline-note" : "inline-warning"}>{d.statusMessage}</div>}
      <div className="metric-table-wrap base-financials">
        <table className="model-grid">
          <tbody>
            <tr><th>Diagnostic</th><th>Value</th></tr>
            <tr><td>Implied CAGR solve status</td><td>{solveStatusLabel(d.solveStatus)}</td></tr>
            <tr><td>Value at -50% growth</td><td>{compactMoney(d.valueAtLowGrowth)}</td></tr>
            <tr><td>Value at +100% growth</td><td>{compactMoney(d.valueAtHighGrowth)}</td></tr>
            <tr><td>Terminal value as % of EV</td><td>{percent(d.terminalValueShare)}</td></tr>
            <tr><td>PV explicit FCF as % of EV</td><td>{percent(d.explicitFcfShare)}</td></tr>
            <tr><td>Current EV / revenue</td><td>{multiple(d.currentEvToRevenue)}</td></tr>
            <tr><td>Implied Y5 revenue</td><td>{compactMoney(d.impliedY5Revenue)}</td></tr>
            <tr><td>Implied Y5 FCF</td><td>{compactMoney(d.impliedY5Fcf)}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExitMultipleStatsTable({ detail, metric }: { detail: CompanyDetail; metric: ExitMetric | null }) {
  const stat = detail.exitMultipleStats.find((item) => item.metric === metric);
  if (!stat) return null;
  return (
    <div className="metric-table-wrap base-financials">
      <table className="model-grid">
        <tbody>
          <tr><th>{stat.label}</th><th>Value</th></tr>
          <tr><td>Current</td><td>{multiple(stat.current)}</td></tr>
          <tr><td>5Y low</td><td>{multiple(stat.low)}</td></tr>
          <tr><td>5Y median</td><td>{multiple(stat.median)}</td></tr>
          <tr><td>5Y high</td><td>{multiple(stat.high)}</td></tr>
          <tr><td>Default source</td><td>{stat.source ?? "-"}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function SensitivitySection({ tables }: { tables: SensitivityTable[] }) {
  if (!tables || tables.length === 0) return null;
  return (
    <section className="section">
      <h3>Sensitivity</h3>
      {tables.map((table) => <SensitivityTableView key={table.title} table={table} />)}
    </section>
  );
}

function SensitivityTableView({ table }: { table: SensitivityTable }) {
  const fmt = (value: number | null, format: SensitivityTable["rowFormat"]) => format === "multiple" ? multiple(value) : percent(value);
  return (
    <div className="model-grid-wrap" style={{ marginBottom: 12 }}>
      <p className="headline-note">{table.title}</p>
      <table className="model-grid">
        <thead>
          <tr>
            <th>{table.rowLabel} \ {table.colLabel}</th>
            {table.colValues.map((value, index) => <th key={index}>{fmt(value, table.colFormat)}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.rowValues.map((rowValue, rowIndex) => (
            <tr key={rowIndex}>
              <td>{fmt(rowValue, table.rowFormat)}</td>
              {table.colValues.map((_, colIndex) => <td key={colIndex}>{percent(table.cells[rowIndex]?.[colIndex] ?? null)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvBridgeSection({ detail }: { detail: CompanyDetail }) {
  const bridge = detail.evBridge;
  return (
    <section className="section">
      <h3>EV Bridge</h3>
      {bridge?.warning && <div className="inline-warning">{bridge.warning}</div>}
      <div className="metric-table-wrap base-financials">
        <table className="model-grid">
          <tbody>
            <tr><th>Item</th><th>Value</th></tr>
            <tr><td>Market cap</td><td>{compactMoney(bridge?.marketCap ?? null)}</td></tr>
            <tr><td>Cash</td><td>{compactMoney(bridge?.cash ?? null)}</td></tr>
            <tr><td>Debt</td><td>{compactMoney(bridge?.debt ?? null)}</td></tr>
            <tr><td>Leases</td><td>{compactMoney(bridge?.leases ?? null)}</td></tr>
            <tr><td>Preferred stock</td><td>{compactMoney(bridge?.preferredStock ?? null)}</td></tr>
            <tr><td>Minority interest</td><td>{compactMoney(bridge?.minorityInterest ?? null)}</td></tr>
            <tr><td>Net debt</td><td>{compactMoney(bridge?.netDebt ?? null)}</td></tr>
            <tr><td>Fiscal calculated TEV</td><td>{compactMoney(bridge?.fiscalEnterpriseValue ?? detail.row.enterpriseValue)}</td></tr>
            <tr><td>Rebuilt EV</td><td>{compactMoney(bridge?.rebuiltEnterpriseValue ?? null)}</td></tr>
            <tr><td>Difference</td><td>{bridge?.differencePercent !== null && bridge?.differencePercent !== undefined ? `${compactMoney(bridge.difference)} (${percent(bridge.differencePercent)})` : compactMoney(bridge?.difference ?? null)}</td></tr>
            <tr><td>Balance sheet date</td><td>{dateShort(bridge?.asOfDate ?? null)}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BaseFinancialsTable({ detail, selected }: { detail: CompanyDetail; selected: BasePeriod | null }) {
  const base = selected === "annual" ? detail.baseFinancials.annual : detail.baseFinancials.ltm ?? detail.baseFinancials.annual;
  return (
    <div className="metric-table-wrap base-financials">
      <table className="model-grid">
        <tbody>
          <tr><th>Input</th><th>Value</th><th>Source</th></tr>
          <tr><td>Revenue base</td><td>{compactMoney(base?.revenue ?? null)}</td><td>{base?.source ?? "-"}</td></tr>
          <tr><td>FCF base</td><td>{compactMoney(base?.fcf ?? null)}</td><td>{base?.source ?? "-"}</td></tr>
          <tr><td>FCF margin</td><td>{percent(base?.fcfMargin ?? null)}</td><td>{detail.sources.normalizedFcfMargin ?? "-"}</td></tr>
          <tr><td>Fiscal period</td><td>{base?.label ?? "-"}</td><td>{dateShort(base?.reportDate ?? null)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function ValuationDetailView({ detail, onSaved }: { detail: ValuationDetail; onSaved: () => Promise<void> }) {
  const [note, setNote] = useState(detail.row.note);
  useEffect(() => setNote(detail.row.note), [detail]);
  async function saveNote() {
    await api(`/api/companies/${detail.row.companyKey}/state`, { method: "PATCH", body: JSON.stringify({ note }) });
    await onSaved();
  }
  return (
    <>
      <div className="detail-header"><div><h2>{detail.row.ticker}</h2><p>{detail.row.name}</p></div><StatusPill status={detail.row.pe.status} /></div>
      <div className="metrics-strip">
        <Metric label="P/E Z" value={zScore(detail.row.pe.zScore)} />
        <Metric label="P/E" value={multiple(detail.row.pe.current)} />
        <Metric label="Mean" value={multiple(detail.row.pe.mean)} />
        <Metric label="Percentile" value={percent(detail.row.pe.percentileRank)} />
      </div>
      <section className="section"><h3>P/E Band</h3><PeBandChart history={detail.peHistory} /></section>
      <section className="section">
        <h3>Valuation Multiples</h3>
        <div className="metric-table-wrap">
          <table className="model-grid">
            <thead><tr><th>Metric</th><th>Current</th><th>Mean</th><th>Z</th><th>Percentile</th><th>Obs</th></tr></thead>
            <tbody>{detail.metrics.map((metric) => <MetricStatsRow key={metric.key} metric={metric} />)}</tbody>
          </table>
        </div>
      </section>
      <NoteSection note={note} setNote={setNote} saveNote={saveNote} />
      <SourcesSection links={[]} terminalUrl={detail.row.terminalUrl} />
    </>
  );
}

function MetricStatsRow({ metric }: { metric: ValuationMetricStats }) {
  const value = metric.key === "fcfYield" ? percent(metric.current) : multiple(metric.current);
  const meanValue = metric.key === "fcfYield" ? percent(metric.mean) : multiple(metric.mean);
  return <tr><td>{metric.label}</td><td>{value}</td><td>{meanValue}</td><td>{zScore(metric.zScore)}</td><td>{percent(metric.percentileRank)}</td><td>{metric.observationCount}</td></tr>;
}

function PeBandChart({ history }: { history: ValuationHistoryPoint[] }) {
  const width = 560;
  const height = 260;
  const pad = 28;
  const series = [
    { label: "Price", color: "#111827", values: history.map((point) => point.price) },
    ...["-2σ", "-1σ", "Mean", "+1σ", "+2σ"].map((label, index) => ({ label, color: ["#16a34a", "#84cc16", "#2563eb", "#f97316", "#dc2626"][index], values: history.map((point) => point.bandPrices[label] ?? null) }))
  ];
  const allValues = series.flatMap((item) => item.values).filter((value): value is number => Number.isFinite(value));
  if (history.length < 2 || allValues.length === 0) return <p>No P/E band history cached yet. Click Refresh data to fetch it from Fiscal.ai.</p>;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = max - min || 1;
  const x = (index: number) => pad + (index / (history.length - 1)) * (width - pad * 2);
  const y = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2);
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Five year P/E band chart">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="axis" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="axis" />
        {series.map((item) => {
          const points = item.values.map((value, index) => Number.isFinite(value) ? `${x(index)},${y(value as number)}` : null).filter(Boolean).join(" ");
          return <polyline key={item.label} points={points} fill="none" stroke={item.color} strokeWidth={item.label === "Price" ? 2.2 : 1.4} />;
        })}
      </svg>
      <div className="chart-legend">{series.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}</div>
    </div>
  );
}

function ModelGrid({ detail }: { detail: CompanyDetail }) {
  return <div className="model-grid-wrap"><table className="model-grid"><thead><tr><th>Line item</th>{detail.gridColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{detail.gridRows.map((row) => <tr key={row.label}><td><span className={`kind ${row.kind}`}>{row.kind}</span>{row.label}</td>{detail.gridColumns.map((_, index) => <td key={index}>{formatCell(row, row.values[index])}</td>)}</tr>)}</tbody></table></div>;
}

function NoteSection({ note, setNote, saveNote }: { note: string; setNote: (value: string) => void; saveNote: () => Promise<void> }) {
  return <section className="section"><h3>Note / Thesis</h3><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Short investment note or thesis..." /><button className="primary-action" onClick={() => void saveNote()}>Save note</button></section>;
}

function SourcesSection({ links, terminalUrl }: { links: Array<{ label: string; url: string }>; terminalUrl: string | null }) {
  return <section className="section source-section"><h3>Sources</h3>{links.length === 0 ? <p>No filing source links cached yet.</p> : links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}{terminalUrl && <a href={terminalUrl} target="_blank" rel="noreferrer">Open source</a>}</section>;
}

function EmptyDetail({ runs, label }: { runs: RefreshRun[]; label: string }) {
  return <div className="empty-detail"><h2>No company selected</h2><p>Select a ticker to inspect the {label}.</p><h3>Recent refreshes</h3>{runs.length === 0 ? <p>No refresh runs yet.</p> : runs.map((run) => <div key={run.id} className="run-row"><span>{run.kind}</span><strong>{run.status}</strong><time>{dateShort(run.finishedAt ?? run.startedAt)}</time></div>)}</div>;
}

function FavoriteButton({ row }: { row: BaseRow }) {
  const [favorite, setFavorite] = useState(row.isFavorite);
  useEffect(() => setFavorite(row.isFavorite), [row.isFavorite]);
  return <button className={`icon-button ${favorite ? "active" : ""}`} title={favorite ? "Remove favorite" : "Add favorite"} onClick={async (event) => { event.stopPropagation(); const next = !favorite; setFavorite(next); await api(`/api/companies/${row.companyKey}/state`, { method: "PATCH", body: JSON.stringify({ isFavorite: next }) }); }}><Star size={16} /></button>;
}

function SignalPill({ signal }: { signal: CompanyRow["signal"] }) {
  const className = signal.includes("low") ? "low" : signal.includes("high") ? "high" : signal.includes("near") ? "near" : "missing";
  return <span className={`signal ${className}`}>{signal}</span>;
}

function StatusPill({ status }: { status: ValuationMetricStats["status"] }) {
  return <span className={`signal ${status === "ok" ? "low" : "missing"}`}>{status}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function InputPercent({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return <label>{label}<input type="number" step="0.1" value={value === null ? "" : (value * 100).toFixed(1)} onChange={(event) => onChange(parseInputPercent(event.target.value))} /></label>;
}

function InputNumber({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return <label>{label}<input type="number" step="0.1" value={value === null ? "" : Number(value).toFixed(1)} onChange={(event) => {
    const next = Number(event.target.value);
    onChange(event.target.value === "" || !Number.isFinite(next) ? null : next);
  }} /></label>;
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? response.statusText);
  return payload as T;
}

function compareValues(a: string | number | boolean | null, b: string | number | boolean | null, direction: "asc" | "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * multiplier;
  return String(a).localeCompare(String(b)) * multiplier;
}

function formatCell(row: ModelCell, value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;
  if (row.format === "currency") return compactMoney(value);
  if (row.format === "percent") return percent(value);
  if (row.format === "multiple") return multiple(value);
  return value.toFixed(2);
}

function money(value: number | null): string {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value as number);
}

function compactMoney(value: number | null): string {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value as number);
}

function percent(value: number | null): string {
  if (!Number.isFinite(value)) return "-";
  return `${((value as number) * 100).toFixed(1)}%`;
}

function multiple(value: number | null): string {
  if (!Number.isFinite(value)) return "-";
  return `${(value as number).toFixed(1)}x`;
}

function zScore(value: number | null): string {
  if (!Number.isFinite(value)) return "-";
  return `${(value as number).toFixed(2)}σ`;
}

function dateShort(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function solveStatusLabel(status: ModelDiagnostics["solveStatus"]): string {
  switch (status) {
    case "ok": return "OK";
    case "above-range": return "Above range";
    case "below-range": return "Below range";
    case "insufficient-data": return "Insufficient data";
    case "invalid-assumptions": return "Invalid assumptions";
    default: return status;
  }
}

function latestDate(values: Array<string | null>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function strong(value: string) {
  return <strong>{value}</strong>;
}

function initialAssumptions(detail: CompanyDetail) {
  return {
    basePeriod: detail.overrides.basePeriod ?? detail.defaults.basePeriod ?? detail.baseFinancials.selected,
    normalizedFcfMargin: detail.overrides.normalizedFcfMargin ?? detail.defaults.normalizedFcfMargin,
    discountRate: detail.overrides.discountRate ?? detail.defaults.discountRate,
    terminalGrowth: detail.overrides.terminalGrowth ?? detail.defaults.terminalGrowth,
    terminalMethod: detail.overrides.terminalMethod ?? detail.defaults.terminalMethod ?? "perpetuity",
    exitMetric: detail.overrides.exitMetric ?? detail.defaults.exitMetric ?? "fcf",
    exitMultiple: detail.overrides.exitMultiple ?? detail.defaults.exitMultiple,
    normalizedEbitdaMargin: detail.overrides.normalizedEbitdaMargin ?? detail.defaults.normalizedEbitdaMargin
  };
}

function parseBasePeriod(value: string): BasePeriod | null {
  return value === "ltm" || value === "annual" ? value : null;
}

function parseTerminalMethod(value: string): TerminalMethod {
  return value === "exit-multiple" ? "exit-multiple" : "perpetuity";
}

function parseExitMetric(value: string): ExitMetric {
  return value === "ebitda" || value === "revenue" ? value : "fcf";
}

function exitMetricLabel(metric: ExitMetric | null): string {
  switch (metric) {
    case "revenue":
      return "revenue";
    case "ebitda":
      return "EBITDA";
    default:
      return "FCF";
  }
}

function parseInputPercent(value: string): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number / 100 : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
