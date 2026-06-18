import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowDownUp,
  BadgeCheck,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  DatabaseZap,
  FileText,
  Gauge,
  LineChart,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Star
} from "lucide-react";
import type {
  BasePeriod,
  ColumnPreference,
  CompanyDetail,
  CompanyRow,
  DailyEvPoint,
  ExitMetric,
  ImpliedGrowthHistoryData,
  ModelCell,
  ModelDiagnostics,
  RealizedGrowthPoint,
  RefreshRun,
  SensitivityTable,
  TerminalMethod,
  ValuationDetail,
  ValuationHistoryPoint,
  ValuationMetricStats,
  ValuationRow
} from "@alphapane/shared";
import { solveImpliedGrowth } from "@alphapane/shared";

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

type WorkbenchSection = "signal" | "assumptions" | "history" | "audit" | "notes";
type AgreementState = "confirmed" | "valuation-only" | "dcf-only" | "divergent" | "inconclusive";
type CompanyPanelMode = "open" | "rail" | "fullscreen";

const companyPanelModeStorageKey = "alphapane.companyPanelMode";

interface OpportunityRow extends BaseRow {
  reverse: CompanyRow;
  valuation: ValuationRow | null;
  rank: number;
  opportunityScore: number;
  valuationScore: number | null;
  dcfScore: number | null;
  trustScore: number;
  agreement: AgreementState;
  evidenceLabel: string;
  trustLabel: string;
  freshnessDate: string | null;
  reasons: string[];
}

const opportunityColumns: TableColumn<OpportunityRow>[] = [
  { key: "actions", label: "", align: "center", render: (row) => <FavoriteButton row={row} /> },
  { key: "rank", label: "Rank", align: "right", render: (row) => `#${row.rank}`, sortValue: (row) => row.opportunityScore },
  { key: "evidence", label: "Evidence", render: (row) => <EvidenceRail row={row} />, sortValue: (row) => row.opportunityScore },
  { key: "ticker", label: "Ticker", render: (row) => <TickerCell row={row} />, sortValue: (row) => row.ticker },
  { key: "valuation", label: "Valuation", align: "right", render: (row) => <LensValue label="P/E Z" value={zScore(row.valuation?.pe.zScore ?? null)} tone="valuation" />, sortValue: (row) => row.valuation?.pe.zScore ?? null },
  { key: "dcf", label: "DCF Gap", align: "right", render: (row) => <LensValue label="Growth" value={percent(row.reverse.cagrGap)} tone="dcf" />, sortValue: (row) => row.reverse.cagrGap },
  { key: "agreement", label: "Agreement", render: (row) => <AgreementPill state={row.agreement} label={row.evidenceLabel} />, sortValue: (row) => agreementSort(row.agreement) },
  { key: "trust", label: "Trust", render: (row) => <TrustPill score={row.trustScore} label={row.trustLabel} />, sortValue: (row) => row.trustScore },
  { key: "price", label: "Price", align: "right", render: (row) => money(row.reverse.sharePrice), sortValue: (row) => row.reverse.sharePrice },
  { key: "sector", label: "Sector", render: (row) => row.sector ?? "-", sortValue: (row) => row.sector },
  { key: "freshness", label: "Freshness", render: (row) => dateShort(row.freshnessDate), sortValue: (row) => row.freshnessDate },
  { key: "note", label: "Note", render: (row) => (row.note.trim() ? "Yes" : "-"), sortValue: (row) => row.note }
];

export function App() {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [valuationRows, setValuationRows] = useState<ValuationRow[]>([]);
  const [preferences, setPreferences] = useState<ColumnPreference[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [valuationDetail, setValuationDetail] = useState<ValuationDetail | null>(null);
  const [runs, setRuns] = useState<RefreshRun[]>([]);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortKey, setSortKey] = useState<string>("opportunityScore");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [workbenchSection, setWorkbenchSection] = useState<WorkbenchSection>("signal");
  const [companyPanelMode, setCompanyPanelMode] = useState<CompanyPanelMode>(() => readStoredCompanyPanelMode());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadDashboard();
  }, []);

  const opportunities = useMemo(() => buildOpportunities(rows, valuationRows), [rows, valuationRows]);

  useEffect(() => {
    if (!selectedKey && opportunities.length > 0) setSelectedKey(opportunities[0].companyKey);
  }, [selectedKey, opportunities]);

  useEffect(() => {
    if (!selectedKey) {
      setDetail(null);
      setValuationDetail(null);
      return;
    }
    void loadSelectedCompany(selectedKey);
  }, [selectedKey]);

  useEffect(() => {
    window.localStorage.setItem(companyPanelModeStorageKey, companyPanelMode);
  }, [companyPanelMode]);

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
      setRuns(refreshPayload.runs);
    } catch (apiError) {
      setError(errorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedCompany(companyKey: string) {
    try {
      const [reverseDetail, valuation] = await Promise.all([
        api<CompanyDetail>(`/api/companies/${companyKey}`),
        api<ValuationDetail>(`/api/valuation/companies/${companyKey}`).catch(() => null)
      ]);
      setDetail(reverseDetail);
      setValuationDetail(valuation);
    } catch (apiError) {
      setError(errorMessage(apiError));
    }
  }

  async function handleSaved() {
    await loadDashboard();
    if (selectedKey) await loadSelectedCompany(selectedKey);
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
        setRefreshStatus("Refreshing financial statements and model defaults");
        applyRefreshPayload(await api<RefreshPayload>("/api/refresh/financials", { method: "POST" }));
        setRefreshStatus("Refreshing market data and valuation history");
        applyRefreshPayload(await api<RefreshPayload>("/api/refresh/prices", { method: "POST" }));
      } else {
        setRefreshStatus(kind === "prices" ? "Refreshing market data and valuation history" : "Refreshing financial statements and model defaults");
        applyRefreshPayload(await api<RefreshPayload>(`/api/refresh/${kind}`, { method: "POST" }));
      }
      if (selectedKey) await loadSelectedCompany(selectedKey);
    } catch (apiError) {
      setError(errorMessage(apiError));
      const refreshPayload = await api<{ runs: RefreshRun[] }>("/api/refresh-runs");
      setRuns(refreshPayload.runs);
    } finally {
      setRefreshing(null);
      setRefreshStatus(null);
    }
  }

  async function toggleColumn(key: string) {
    const hidden = new Set(preferences.filter((pref) => pref.visible === false).map((pref) => pref.key));
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    const next = opportunityColumns.filter((column) => column.key !== "actions").map((column) => ({ key: column.key, visible: !hidden.has(column.key) }));
    setPreferences(next);
    await api("/api/preferences/columns", {
      method: "PATCH",
      body: JSON.stringify({ columns: next, key: "reverseDcfColumns" })
    });
  }

  const latestFreshness = latestDate(opportunities.map((row) => row.freshnessDate));
  const agreementCount = opportunities.filter((row) => row.agreement === "confirmed").length;
  const weakTrustCount = opportunities.filter((row) => row.trustScore < 0.65).length;
  const selectedOpportunity = opportunities.find((row) => row.companyKey === selectedKey) ?? null;
  const table = useTable(opportunities, opportunityColumns, preferences, query, favoritesOnly, sortKey, sortDirection);

  return (
    <div className="shell cockpit-shell">
      <header className="topbar cockpit-topbar">
        <div className="brand-lockup">
          <span className="brand-mark">AP</span>
          <div>
            <h1>AlphaPane</h1>
            <p>Evidence-ranked research queue for a curated investment universe.</p>
          </div>
        </div>
        <div className="cockpit-metrics" aria-label="Universe status">
          <Metric label="Universe" value={String(opportunities.length)} />
          <Metric label="Agreement" value={String(agreementCount)} />
          <Metric label="Audit flags" value={String(weakTrustCount)} />
          <Metric label="Freshness" value={dateShort(latestFreshness)} />
        </div>
        <RefreshControl runs={runs} refreshing={refreshing} refreshStatus={refreshStatus} runRefresh={runRefresh} />
      </header>

      {error && <div className="error">{error}</div>}

      <main className={`layout cockpit-layout panel-${companyPanelMode}`}>
        <section className="table-section opportunity-section">
          <div className="queue-header">
            <div>
              <p className="eyebrow">Opportunity queue</p>
              <h2>Open the companies where the evidence agrees first.</h2>
            </div>
            <div className="queue-actions">
              <label className="search">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticker, company, sector" />
              </label>
              <label className="check">
                <input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />
                Favorites
              </label>
              <details className="columns-menu">
                <summary><Columns3 size={16} /> Columns</summary>
                <div>
                  {opportunityColumns.filter((column) => column.key !== "actions").map((column) => (
                    <label key={column.key}>
                      <input type="checkbox" checked={!table.hiddenKeys.has(column.key)} onChange={() => void toggleColumn(column.key)} />
                      {column.label}
                    </label>
                  ))}
                </div>
              </details>
            </div>
          </div>
          <div className="evidence-key" aria-label="Evidence lens legend">
            <span><i className="valuation-dot" /> Historical valuation is the objective lens</span>
            <span><i className="dcf-dot" /> Reverse DCF is the judgment lens</span>
            <span><i className="confirmed-dot" /> Agreement is the strongest signal</span>
          </div>
          <DataTable<OpportunityRow>
            rows={table.filteredRows}
            columns={table.visibleColumns}
            loading={loading}
            selectedKey={selectedKey}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key) => {
              if (key === "actions") return;
              if (sortKey === key) setSortDirection(sortDirection === "asc" ? "desc" : "asc");
              else {
                setSortKey(key);
                setSortDirection(key === "opportunityScore" || key === "rank" || key === "trust" ? "desc" : "asc");
              }
            }}
            onSelect={setSelectedKey}
          />
        </section>

        <aside className="detail-panel workbench-panel" aria-label="Selected company workbench">
          {companyPanelMode === "rail" ? (
            <CompanyPanelRail
              opportunity={selectedOpportunity}
              detail={detail}
              setMode={setCompanyPanelMode}
            />
          ) : (
            <CompanyWorkbench
              opportunity={selectedOpportunity}
              detail={detail}
              valuationDetail={valuationDetail}
              section={workbenchSection}
              setSection={setWorkbenchSection}
              mode={companyPanelMode}
              setMode={setCompanyPanelMode}
              runs={runs}
              onSaved={handleSaved}
            />
          )}
        </aside>
      </main>
    </div>
  );
}

function readStoredCompanyPanelMode(): CompanyPanelMode {
  if (typeof window === "undefined") return "open";
  const stored = window.localStorage.getItem(companyPanelModeStorageKey);
  return stored === "rail" || stored === "fullscreen" || stored === "open" ? stored : "open";
}

function RefreshControl({ runs, refreshing, refreshStatus, runRefresh }: {
  runs: RefreshRun[];
  refreshing: string | null;
  refreshStatus: string | null;
  runRefresh: (kind: "all" | "prices" | "financials") => Promise<void>;
}) {
  const latestRun = runs[0];
  return (
    <div className="refresh-control">
      <div>
        <span>Data control</span>
        <strong>{refreshing ? refreshStatus ?? "Refreshing" : latestRun ? `${latestRun.kind}: ${latestRun.status}` : "No refreshes yet"}</strong>
      </div>
      <button className="primary-refresh" onClick={() => void runRefresh("all")} disabled={Boolean(refreshing)}>
        <RefreshCw size={16} className={refreshing ? "spin" : undefined} />
        {refreshing ? "Running" : "Refresh all"}
      </button>
      <details className="refresh-menu">
        <summary aria-label="Advanced refresh options"><ChevronDown size={16} /></summary>
        <div>
          <button onClick={() => void runRefresh("prices")} disabled={Boolean(refreshing)}>
            <Activity size={15} />
            <span><strong>Market and valuation</strong><small>Prices, multiples, P/E bands, daily EV history</small></span>
          </button>
          <button onClick={() => void runRefresh("financials")} disabled={Boolean(refreshing)}>
            <DatabaseZap size={15} />
            <span><strong>Financials and DCF</strong><small>Statements, sources, defaults, model outputs</small></span>
          </button>
        </div>
      </details>
    </div>
  );
}

function CompanyPanelRail({ opportunity, detail, setMode }: {
  opportunity: OpportunityRow | null;
  detail: CompanyDetail | null;
  setMode: (mode: CompanyPanelMode) => void;
}) {
  const ticker = detail?.row.ticker ?? opportunity?.ticker ?? "AP";
  return (
    <div className="company-panel-rail">
      <button className="icon-button" onClick={() => setMode("open")} aria-label="Show selected company panel" title="Show selected company panel">
        <ChevronsLeft size={17} />
      </button>
      <button className="icon-button" onClick={() => setMode("fullscreen")} aria-label="Expand selected company panel" title="Expand selected company panel">
        <Maximize2 size={16} />
      </button>
      <div className="rail-ticker" aria-label={`Selected company ${ticker}`}>
        <span>{ticker}</span>
      </div>
    </div>
  );
}

function CompanyWorkbench({ opportunity, detail, valuationDetail, section, setSection, mode, setMode, runs, onSaved }: {
  opportunity: OpportunityRow | null;
  detail: CompanyDetail | null;
  valuationDetail: ValuationDetail | null;
  section: WorkbenchSection;
  setSection: (section: WorkbenchSection) => void;
  mode: CompanyPanelMode;
  setMode: (mode: CompanyPanelMode) => void;
  runs: RefreshRun[];
  onSaved: () => Promise<void>;
}) {
  if (!opportunity || !detail) {
    return (
      <>
        <CompanyPanelControls mode={mode} setMode={setMode} />
        <EmptyDetail runs={runs} label="company workbench" />
      </>
    );
  }
  const nav: Array<{ key: WorkbenchSection; label: string; icon: ReactNode }> = [
    { key: "signal", label: "Signal", icon: <Gauge size={15} /> },
    { key: "assumptions", label: "Assumptions", icon: <Settings2 size={15} /> },
    { key: "history", label: "History", icon: <LineChart size={15} /> },
    { key: "audit", label: "Audit", icon: <ShieldCheck size={15} /> },
    { key: "notes", label: "Notes", icon: <FileText size={15} /> }
  ];
  return (
    <>
      <div className="workbench-header">
        <div>
          <p className="eyebrow">Selected company</p>
          <h2>{detail.row.ticker}</h2>
          <p>{detail.row.name}</p>
        </div>
        <div className="workbench-header-actions">
          <CompanyPanelControls mode={mode} setMode={setMode} />
          <AgreementPill state={opportunity.agreement} label={opportunity.evidenceLabel} />
        </div>
      </div>
      <div className="workbench-evidence">
        <EvidenceRail row={opportunity} expanded />
        <TrustPill score={opportunity.trustScore} label={opportunity.trustLabel} />
      </div>
      <nav className="workbench-tabs" aria-label="Company workbench sections">
        {nav.map((item) => (
          <button key={item.key} className={section === item.key ? "active" : ""} onClick={() => setSection(item.key)}>
            {item.icon}{item.label}
          </button>
        ))}
      </nav>
      {section === "signal" && <SignalWorkbench opportunity={opportunity} detail={detail} valuationDetail={valuationDetail} />}
      {section === "assumptions" && <AssumptionsWorkbench detail={detail} onSaved={onSaved} />}
      {section === "history" && <HistoryWorkbench detail={detail} valuationDetail={valuationDetail} />}
      {section === "audit" && <AuditWorkbench detail={detail} valuationDetail={valuationDetail} />}
      {section === "notes" && <NotesWorkbench detail={detail} onSaved={onSaved} />}
    </>
  );
}

function CompanyPanelControls({ mode, setMode }: {
  mode: CompanyPanelMode;
  setMode: (mode: CompanyPanelMode) => void;
}) {
  return (
    <div className="company-panel-controls" aria-label="Selected company panel controls">
      <button className="icon-button" onClick={() => setMode("rail")} aria-label="Hide selected company panel" title="Hide selected company panel">
        <ChevronsRight size={17} />
      </button>
      <button
        className={`icon-button ${mode === "fullscreen" ? "active" : ""}`}
        onClick={() => setMode(mode === "fullscreen" ? "open" : "fullscreen")}
        aria-label={mode === "fullscreen" ? "Exit full screen company panel" : "Expand selected company panel"}
        title={mode === "fullscreen" ? "Exit full screen company panel" : "Expand selected company panel"}
      >
        {mode === "fullscreen" ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
    </div>
  );
}

function SignalWorkbench({ opportunity, detail, valuationDetail }: { opportunity: OpportunityRow; detail: CompanyDetail; valuationDetail: ValuationDetail | null }) {
  return (
    <div className="workbench-section">
      {detail.row.caution && <div className="caution">{detail.row.caution}</div>}
      <div className="lens-grid">
        <LensCard
          tone="valuation"
          title="Historical valuation"
          status={valuationDetail?.row.pe.status === "ok" ? "Objective lens ready" : "Needs more observations"}
          primary={zScore(valuationDetail?.row.pe.zScore ?? null)}
          secondary={`P/E percentile ${percent(valuationDetail?.row.pe.percentileRank ?? null)}`}
        />
        <LensCard
          tone="dcf"
          title="Reverse DCF"
          status="Investor judgment required"
          primary={percent(detail.row.impliedRevenueCagr)}
          secondary={`History ${percent(detail.row.historicalRevenueCagr5y)} / gap ${percent(detail.row.cagrGap)}`}
        />
      </div>
      <section className="section signal-brief">
        <h3>Why this company is here</h3>
        <ul>
          {opportunity.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </section>
      <div className="metrics-strip">
        <Metric label="Score" value={opportunity.opportunityScore.toFixed(0)} />
        <Metric label="P/E Z" value={zScore(valuationDetail?.row.pe.zScore ?? null)} />
        <Metric label="Priced-in CAGR" value={percent(detail.row.impliedRevenueCagr)} />
        <Metric label="Trust" value={`${Math.round(opportunity.trustScore * 100)}%`} />
      </div>
    </div>
  );
}

function AssumptionsWorkbench({ detail, onSaved }: { detail: CompanyDetail; onSaved: () => Promise<void> }) {
  const [assumptions, setAssumptions] = useState(() => initialAssumptions(detail));
  useEffect(() => setAssumptions(initialAssumptions(detail)), [detail]);
  const isExitMode = assumptions.terminalMethod === "exit-multiple";

  async function saveAssumptions() {
    await api(`/api/companies/${detail.row.companyKey}/assumptions`, { method: "PATCH", body: JSON.stringify(assumptions) });
    await onSaved();
  }

  return (
    <div className="workbench-section">
      <section className="section assumption-console">
        <h3>Model controls</h3>
        <div className="assumption-grid">
          <label>Base period
            <select value={assumptions.basePeriod ?? ""} onChange={(event) => setAssumptions({ ...assumptions, basePeriod: parseBasePeriod(event.target.value) })}>
              <option value="" disabled>Select base</option>
              <option value="ltm" disabled={!detail.baseFinancials.ltm}>LTM</option>
              <option value="annual" disabled={!detail.baseFinancials.annual}>Latest Annual</option>
            </select>
          </label>
          <InputPercent label="FCF margin" value={assumptions.normalizedFcfMargin} onChange={(value) => setAssumptions({ ...assumptions, normalizedFcfMargin: value })} />
          <InputPercent label="Discount rate" value={assumptions.discountRate} onChange={(value) => setAssumptions({ ...assumptions, discountRate: value })} />
          <label>Terminal method
            <select value={assumptions.terminalMethod} onChange={(event) => setAssumptions({ ...assumptions, terminalMethod: parseTerminalMethod(event.target.value) })}>
              <option value="perpetuity">Perpetuity Growth</option>
              <option value="exit-multiple">Exit Multiple</option>
            </select>
          </label>
          {!isExitMode && <InputPercent label="Terminal growth" value={assumptions.terminalGrowth} onChange={(value) => setAssumptions({ ...assumptions, terminalGrowth: value })} />}
          {isExitMode && (
            <label>Exit metric
              <select value={assumptions.exitMetric} onChange={(event) => setAssumptions({ ...assumptions, exitMetric: parseExitMetric(event.target.value) })}>
                <option value="fcf">FCF</option>
                <option value="ebitda">EBITDA</option>
                <option value="revenue">Revenue</option>
              </select>
            </label>
          )}
          {isExitMode && <InputNumber label="Exit multiple" value={assumptions.exitMultiple} onChange={(value) => setAssumptions({ ...assumptions, exitMultiple: value })} />}
          {isExitMode && assumptions.exitMetric === "ebitda" && <InputPercent label="EBITDA margin" value={assumptions.normalizedEbitdaMargin} onChange={(value) => setAssumptions({ ...assumptions, normalizedEbitdaMargin: value })} />}
        </div>
        {isExitMode && <ExitMultipleStatsTable detail={detail} metric={assumptions.exitMetric} />}
        <button className="primary-action" onClick={() => void saveAssumptions()}>Save assumptions</button>
      </section>
      <section className="section"><h3>Base financials</h3><BaseFinancialsTable detail={detail} selected={assumptions.basePeriod} /></section>
      <SensitivitySection tables={detail.sensitivity} />
    </div>
  );
}

function HistoryWorkbench({ detail, valuationDetail }: { detail: CompanyDetail; valuationDetail: ValuationDetail | null }) {
  return (
    <div className="workbench-section">
      {valuationDetail && <section className="section"><h3>P/E Band</h3><PeBandChart history={valuationDetail.peHistory} /></section>}
      <ImpliedGrowthHistorySection detail={detail} />
    </div>
  );
}

function AuditWorkbench({ detail, valuationDetail }: { detail: CompanyDetail; valuationDetail: ValuationDetail | null }) {
  return (
    <div className="workbench-section">
      <section className="section"><h3>Default sources</h3><div className="source-grid"><Metric label="Revenue" value={detail.sources.latestRevenue ?? "-"} /><Metric label="FCF margin" value={detail.sources.normalizedFcfMargin ?? "-"} /><Metric label="History CAGR" value={detail.sources.historicalRevenueCagr5y ?? "-"} /><Metric label="Exit multiple" value={detail.sources.exitMultiple ?? "-"} /></div></section>
      <EvBridgeSection detail={detail} />
      <ModelDiagnosticsSection detail={detail} />
      {valuationDetail && <section className="section"><h3>Valuation multiples</h3><div className="metric-table-wrap"><table className="model-grid"><thead><tr><th>Metric</th><th>Current</th><th>Mean</th><th>Z</th><th>Percentile</th><th>Obs</th></tr></thead><tbody>{valuationDetail.metrics.map((metric) => <MetricStatsRow key={metric.key} metric={metric} />)}</tbody></table></div></section>}
      <section className="section"><h3>Model grid</h3><ModelGrid detail={detail} /></section>
      <SourcesSection links={detail.sourceLinks} terminalUrl={detail.row.terminalUrl} />
    </div>
  );
}

function NotesWorkbench({ detail, onSaved }: { detail: CompanyDetail; onSaved: () => Promise<void> }) {
  const [note, setNote] = useState(detail.row.note);
  useEffect(() => setNote(detail.row.note), [detail]);
  async function saveNote() {
    await api(`/api/companies/${detail.row.companyKey}/state`, { method: "PATCH", body: JSON.stringify({ note }) });
    await onSaved();
  }
  return <div className="workbench-section"><NoteSection note={note} setNote={setNote} saveNote={saveNote} /></div>;
}

function buildOpportunities(rows: CompanyRow[], valuationRows: ValuationRow[]): OpportunityRow[] {
  const valuationByKey = new Map(valuationRows.map((row) => [row.companyKey, row]));
  const scored = rows.map((reverse) => {
    const valuation = valuationByKey.get(reverse.companyKey) ?? null;
    const valuationScore = scoreValuationLens(valuation);
    const dcfScore = scoreDcfLens(reverse);
    const agreement = classifyAgreement(valuationScore, dcfScore);
    const trustScore = scoreTrust(reverse, valuation);
    const opportunityScore = Math.max(0, Math.min(100,
      45 +
      (valuationScore ?? 0) * 23 +
      (dcfScore ?? 0) * 23 +
      (agreement === "confirmed" ? 14 : agreement === "divergent" ? -12 : 0) +
      (trustScore - 0.7) * 16
    ));
    return {
      companyKey: reverse.companyKey,
      ticker: reverse.ticker,
      name: reverse.name,
      sector: reverse.sector,
      isFavorite: reverse.isFavorite,
      note: reverse.note,
      reverse,
      valuation,
      rank: 0,
      opportunityScore,
      valuationScore,
      dcfScore,
      trustScore,
      agreement,
      evidenceLabel: evidenceLabel(agreement),
      trustLabel: trustLabel(trustScore, reverse, valuation),
      freshnessDate: latestDate([reverse.financialsUpdatedAt, reverse.pricesUpdatedAt, valuation?.valuationUpdatedAt ?? null]),
      reasons: opportunityReasons(reverse, valuation, valuationScore, dcfScore, agreement, trustScore)
    } satisfies OpportunityRow;
  }).sort((a, b) => b.opportunityScore - a.opportunityScore);
  return scored.map((row, index) => ({ ...row, rank: index + 1 }));
}

function scoreValuationLens(row: ValuationRow | null): number | null {
  if (!row || row.pe.status !== "ok") return null;
  const scores = [row.pe, row.evSales, row.evEbitda, row.priceSales, row.fcfYield]
    .map((metric) => metric.status === "ok" && Number.isFinite(metric.zScore) ? -(metric.zScore as number) / 2 : null)
    .filter((value): value is number => value !== null);
  if (scores.length === 0) return null;
  return clamp(scores.reduce((sum, value) => sum + value, 0) / scores.length, -1, 1);
}

function scoreDcfLens(row: CompanyRow): number | null {
  if (!Number.isFinite(row.cagrGap)) return null;
  return clamp(-(row.cagrGap as number) / 0.08, -1, 1);
}

function scoreTrust(reverse: CompanyRow, valuation: ValuationRow | null): number {
  let score = 1;
  if (!reverse.financialsUpdatedAt) score -= 0.2;
  if (!reverse.pricesUpdatedAt) score -= 0.2;
  if (!valuation?.valuationUpdatedAt) score -= 0.15;
  if (reverse.signal === "insufficient data") score -= 0.25;
  if (valuation && valuation.pe.status !== "ok") score -= 0.2;
  if (reverse.caution) score -= 0.12;
  return clamp(score, 0, 1);
}

function classifyAgreement(valuationScore: number | null, dcfScore: number | null): AgreementState {
  const valuationPositive = valuationScore !== null && valuationScore > 0.15;
  const dcfPositive = dcfScore !== null && dcfScore > 0.15;
  const valuationNegative = valuationScore !== null && valuationScore < -0.15;
  const dcfNegative = dcfScore !== null && dcfScore < -0.15;
  if (valuationPositive && dcfPositive) return "confirmed";
  if (valuationPositive && dcfScore !== null && !dcfPositive) return "valuation-only";
  if (dcfPositive && valuationScore !== null && !valuationPositive) return "dcf-only";
  if ((valuationPositive && dcfNegative) || (dcfPositive && valuationNegative)) return "divergent";
  return "inconclusive";
}

function opportunityReasons(
  reverse: CompanyRow,
  valuation: ValuationRow | null,
  valuationScore: number | null,
  dcfScore: number | null,
  agreement: AgreementState,
  trustScore: number
): string[] {
  const reasons: string[] = [];
  if (agreement === "confirmed") reasons.push("Historical valuation and reverse DCF both point toward a potentially interesting setup.");
  if (agreement === "valuation-only") reasons.push("Historical valuation looks statistically cheap, but the DCF expectation lens does not yet confirm it.");
  if (agreement === "dcf-only") reasons.push("Priced-in growth looks low versus history, but the objective valuation lens does not yet confirm it.");
  if (agreement === "divergent") reasons.push("The two evidence lenses disagree, so this needs judgment before it deserves deeper work.");
  if (agreement === "inconclusive") reasons.push("The available evidence is not yet strong enough to create a high-confidence queue signal.");
  if (valuationScore !== null) reasons.push(`Valuation lens score: ${signedNumber(valuationScore)} from the company\'s own multiple history.`);
  if (dcfScore !== null) reasons.push(`DCF lens score: ${signedNumber(dcfScore)} from priced-in growth versus historical growth.`);
  if (valuation?.pe.status !== "ok") reasons.push("P/E history does not have enough valid observations for the objective lens.");
  if (reverse.signal === "insufficient data") reasons.push("Reverse DCF output is limited by missing or invalid model inputs.");
  if (reverse.caution) reasons.push(reverse.caution);
  if (trustScore < 0.65) reasons.push("Audit score is weak; inspect freshness, sources, and diagnostics before relying on the signal.");
  return reasons;
}

function evidenceLabel(state: AgreementState): string {
  switch (state) {
    case "confirmed": return "Both lenses agree";
    case "valuation-only": return "Valuation only";
    case "dcf-only": return "DCF only";
    case "divergent": return "Lenses diverge";
    default: return "Inconclusive";
  }
}

function agreementSort(state: AgreementState): number {
  switch (state) {
    case "confirmed": return 5;
    case "valuation-only": return 4;
    case "dcf-only": return 3;
    case "divergent": return 2;
    default: return 1;
  }
}

function trustLabel(score: number, reverse: CompanyRow, valuation: ValuationRow | null): string {
  if (score >= 0.85) return "High audit confidence";
  if (!reverse.financialsUpdatedAt || !reverse.pricesUpdatedAt || !valuation?.valuationUpdatedAt) return "Refresh needed";
  if (reverse.signal === "insufficient data" || valuation?.pe.status !== "ok") return "Insufficient data";
  return "Inspect audit trail";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function signedNumber(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function EvidenceRail({ row, expanded = false }: { row: OpportunityRow; expanded?: boolean }) {
  const valuation = scoreToPercent(row.valuationScore);
  const dcf = scoreToPercent(row.dcfScore);
  return (
    <div className={`evidence-rail ${expanded ? "expanded" : ""}`}>
      <div className="rail-row"><span>Valuation</span><i><b className="valuation-bar" style={{ width: `${valuation}%` }} /></i><strong>{row.valuationScore === null ? "-" : signedNumber(row.valuationScore)}</strong></div>
      <div className="rail-row"><span>DCF</span><i><b className="dcf-bar" style={{ width: `${dcf}%` }} /></i><strong>{row.dcfScore === null ? "-" : signedNumber(row.dcfScore)}</strong></div>
    </div>
  );
}

function scoreToPercent(score: number | null): number {
  if (score === null) return 4;
  return 8 + clamp((score + 1) / 2, 0, 1) * 92;
}

function TickerCell({ row }: { row: OpportunityRow }) {
  return <div className="ticker-cell"><strong>{row.ticker}</strong><span>{row.name}</span></div>;
}

function LensValue({ label, value, tone }: { label: string; value: string; tone: "valuation" | "dcf" }) {
  return <div className={`lens-value ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function AgreementPill({ state, label }: { state: AgreementState; label: string }) {
  return <span className={`agreement-pill ${state}`}>{state === "confirmed" && <BadgeCheck size={13} />}{label}</span>;
}

function TrustPill({ score, label }: { score: number; label: string }) {
  const level = score >= 0.85 ? "high" : score >= 0.65 ? "medium" : "low";
  return <span className={`trust-pill ${level}`}><ShieldCheck size={13} />{label}</span>;
}

function LensCard({ tone, title, status, primary, secondary }: { tone: "valuation" | "dcf"; title: string; status: string; primary: string; secondary: string }) {
  return (
    <section className={`lens-card ${tone}`}>
      <span>{status}</span>
      <h3>{title}</h3>
      <strong>{primary}</strong>
      <p>{secondary}</p>
    </section>
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
      <ImpliedGrowthHistorySection detail={detail} />
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

function ImpliedGrowthHistorySection({ detail }: { detail: CompanyDetail }) {
  const [historyData, setHistoryData] = useState<ImpliedGrowthHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<1 | 3 | 5 | 0>(5);
  const [showRealized, setShowRealized] = useState(false);

  const defaults = useMemo(() => initialAssumptions(detail), [detail]);

  const [discountRate, setDiscountRate] = useState<number>(defaults.discountRate ?? 0.1);
  const [fcfMargin, setFcfMargin] = useState<number>(defaults.normalizedFcfMargin ?? 0.2);
  const [terminalGrowth, setTerminalGrowth] = useState<number>(defaults.terminalGrowth ?? 0.03);
  const [exitMultiple, setExitMultiple] = useState<number>(defaults.exitMultiple ?? 20);

  useEffect(() => {
    setDiscountRate(defaults.discountRate ?? 0.1);
    setFcfMargin(defaults.normalizedFcfMargin ?? 0.2);
    setTerminalGrowth(defaults.terminalGrowth ?? 0.03);
    setExitMultiple(defaults.exitMultiple ?? 20);
  }, [defaults]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<ImpliedGrowthHistoryData>(`/api/companies/${detail.row.companyKey}/implied-growth-history`)
      .then((data) => { if (!cancelled) setHistoryData(data); })
      .catch(() => { if (!cancelled) setHistoryData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [detail.row.companyKey]);

  const isExitMode = defaults.terminalMethod === "exit-multiple";

  const chartPoints = useMemo(() => {
    if (!historyData || historyData.dailyEv.length === 0) return [];
    const dailyEv = historyData.dailyEv;
    const latest = dailyEv[dailyEv.length - 1].date;
    if (timeRange > 0) {
      const cutoff = new Date(latest + "T00:00:00.000Z");
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - timeRange);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const filtered = dailyEv.filter((point) => point.date >= cutoffStr && point.enterpriseValue !== null);
      return solveHistoryPoints(filtered, historyData.revenueTimeline, { discountRate, fcfMargin, terminalGrowth, exitMultiple, terminalMethod: defaults.terminalMethod ?? "perpetuity", exitMetric: defaults.exitMetric ?? "fcf", normalizedEbitdaMargin: defaults.normalizedEbitdaMargin ?? null });
    }
    return solveHistoryPoints(dailyEv.filter((point) => point.enterpriseValue !== null), historyData.revenueTimeline, { discountRate, fcfMargin, terminalGrowth, exitMultiple, terminalMethod: defaults.terminalMethod ?? "perpetuity", exitMetric: defaults.exitMetric ?? "fcf", normalizedEbitdaMargin: defaults.normalizedEbitdaMargin ?? null });
  }, [historyData, timeRange, discountRate, fcfMargin, terminalGrowth, exitMultiple, defaults.terminalMethod, defaults.exitMetric, defaults.normalizedEbitdaMargin]);

  if (loading) return <section className="section"><h3>Priced-In Growth History</h3><p>Loading history data…</p></section>;
  if (!historyData || historyData.dailyEv.length < 30) {
    return <section className="section"><h3>Priced-In Growth History</h3><p>Insufficient daily EV history for this company. Run a price refresh to fetch data from Fiscal.ai.</p></section>;
  }

  const latestValue = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1].impliedCagr : null;
  const earliestShown = chartPoints.length > 0 ? chartPoints[0].date : null;
  const latestShown = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1].date : null;
  const historyLabel = earliestShown && latestShown ? `${earliestShown} to ${latestShown} (${chartPoints.length} days)` : "";

  return (
    <section className="section">
      <h3>Priced-In Growth History</h3>
      <div className="assumption-grid">
        <label>Discount rate ({percent(discountRate)})
          <input type="range" min={3} max={20} step={0.5} value={discountRate * 100} onChange={(e) => setDiscountRate(Number(e.target.value) / 100)} />
        </label>
        <label>FCF margin ({percent(fcfMargin)})
          <input type="range" min={1} max={60} step={1} value={fcfMargin * 100} onChange={(e) => setFcfMargin(Number(e.target.value) / 100)} />
        </label>
        {isExitMode ? (
          <label>Exit multiple ({exitMultiple.toFixed(0)}x)
            <input type="range" min={5} max={50} step={1} value={exitMultiple} onChange={(e) => setExitMultiple(Number(e.target.value))} />
          </label>
        ) : (
          <label>Terminal growth ({percent(terminalGrowth)})
            <input type="range" min={0} max={5} step={0.5} value={terminalGrowth * 100} onChange={(e) => setTerminalGrowth(Number(e.target.value) / 100)} />
          </label>
        )}
      </div>
      <div className="assumption-grid" style={{ marginBottom: 12 }}>
        <div>
          {["1Y", "3Y", "5Y", "Max"].map((label) => {
            const value = label === "Max" ? 0 : Number(label[0]) as 1 | 3 | 5;
            return <button key={label} className={timeRange === value ? "primary-action" : ""} onClick={() => setTimeRange(value)} style={{ marginRight: 4 }}>{label}</button>;
          })}
        </div>
        <label className="checkbox-label"><input type="checkbox" checked={showRealized} onChange={(e) => setShowRealized(e.target.checked)} /> Show actual realized growth</label>
      </div>
      {latestValue !== null && <p className="headline-note">Most recent priced-in CAGR: {percent(latestValue)} · {historyLabel}</p>}
      <ImpliedGrowthChart
        points={chartPoints}
        realizedGrowth={showRealized ? historyData.realizedGrowth : []}
      />
      {showRealized && <p className="headline-note">Realized growth shown as a dashed line. Partial/annualized values (within the last 5 years) are marked with a lighter dash pattern.</p>}
    </section>
  );
}

interface HistorySolveParams {
  discountRate: number;
  fcfMargin: number;
  terminalGrowth: number;
  exitMultiple: number;
  terminalMethod: TerminalMethod;
  exitMetric: ExitMetric;
  normalizedEbitdaMargin: number | null;
}

function solveHistoryPoints(
  dailyEv: DailyEvPoint[],
  revenueTimeline: Array<{ reportDate: string; revenue: number }>,
  params: HistorySolveParams
): Array<{ date: string; impliedCagr: number | null }> {
  const sortedRevenue = [...revenueTimeline].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  return dailyEv.map((point) => {
    const baseRevenue = pointInTimeRevenue(point.date, sortedRevenue);
    if (baseRevenue === null) return { date: point.date, impliedCagr: null };
    const impliedCagr = solveImpliedGrowth({
      enterpriseValue: point.enterpriseValue,
      baseRevenue,
      normalizedFcfMargin: params.fcfMargin,
      discountRate: params.discountRate,
      terminalGrowth: params.terminalGrowth,
      terminalMethod: params.terminalMethod,
      exitMetric: params.exitMetric,
      exitMultiple: params.exitMultiple,
      normalizedEbitdaMargin: params.normalizedEbitdaMargin
    });
    return { date: point.date, impliedCagr };
  });
}

function pointInTimeRevenue(date: string, sortedRevenue: Array<{ reportDate: string; revenue: number }>): number | null {
  let result: number | null = null;
  for (const point of sortedRevenue) {
    if (point.reportDate <= date) result = point.revenue;
    else break;
  }
  return result;
}

function ImpliedGrowthChart({
  points,
  realizedGrowth
}: {
  points: Array<{ date: string; impliedCagr: number | null }>;
  realizedGrowth: RealizedGrowthPoint[];
}) {
  const width = 560;
  const height = 260;
  const plot = { top: 18, right: 16, bottom: 52, left: 62 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;

  if (points.length < 2) return <p>Not enough data points to draw a chart.</p>;

  const firstDate = points[0].date;
  const lastDate = points[points.length - 1].date;
  const firstDateMs = axisDateMs(firstDate);
  const lastDateMs = axisDateMs(lastDate);
  const dateSpan = Math.max(lastDateMs - firstDateMs, 1);
  const visibleRealizedGrowth = realizedGrowth.filter((point) => point.date >= firstDate && point.date <= lastDate);
  const validImplied = points.map((p) => p.impliedCagr).filter((v): v is number => Number.isFinite(v));
  const validRealized = visibleRealizedGrowth.map((p) => p.realizedCagr).filter((v): v is number => Number.isFinite(v));
  const allValues = [...validImplied, ...validRealized];
  if (allValues.length === 0) return <p>No solvable data points in the selected range.</p>;

  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const yTicks = chartTicks(rawMin, rawMax, 5);
  const min = yTicks[0] ?? rawMin;
  const max = yTicks[yTicks.length - 1] ?? rawMax;
  const span = max - min || 0.1;

  const x = (date: string) => plot.left + ((axisDateMs(date) - firstDateMs) / dateSpan) * plotWidth;
  const y = (value: number) => height - plot.bottom - ((value - min) / span) * plotHeight;
  const xTickIndexes = chartDateTickIndexes(points.length);

  const impliedPoints = points
    .map((point, index) => {
      if (point.impliedCagr === null || !Number.isFinite(point.impliedCagr)) return null;
      return `${x(point.date)},${y(point.impliedCagr)}`;
    })
    .filter(Boolean)
    .join(" ");

  const sortedRealized = [...visibleRealizedGrowth].sort((a, b) => a.date.localeCompare(b.date));
  const realizedFullPoints = sortedRealized
    .filter((point) => !point.isPartial && point.realizedCagr !== null && Number.isFinite(point.realizedCagr))
    .map((point) => {
      const xi = x(point.date);
      return `${xi},${y(point.realizedCagr as number)}`;
    })
    .join(" ");
  const realizedPartialPoints = sortedRealized
    .filter((point) => point.isPartial && point.realizedCagr !== null && Number.isFinite(point.realizedCagr))
    .map((point) => {
      const xi = x(point.date);
      return `${xi},${y(point.realizedCagr as number)}`;
    })
    .join(" ");

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Priced-in growth history chart">
        <line x1={plot.left} y1={height - plot.bottom} x2={width - plot.right} y2={height - plot.bottom} className="axis" />
        <line x1={plot.left} y1={plot.top} x2={plot.left} y2={height - plot.bottom} className="axis" />
        {yTicks.map((tick) => {
          const tickY = y(tick);
          return (
            <g key={tick} className="chart-tick">
              <line x1={plot.left - 4} y1={tickY} x2={width - plot.right} y2={tickY} className="grid-line" />
              <text x={plot.left - 8} y={tickY + 4} textAnchor="end">{percent(tick)}</text>
            </g>
          );
        })}
        {xTickIndexes.map((index) => {
          const tickX = x(points[index].date);
          return (
            <g key={`${points[index].date}-${index}`} className="chart-tick">
              <line x1={tickX} y1={height - plot.bottom} x2={tickX} y2={height - plot.bottom + 4} className="tick-line" />
              <text x={tickX} y={height - plot.bottom + 18} textAnchor="middle">{formatAxisDate(points[index].date)}</text>
            </g>
          );
        })}
        <text className="axis-title" x={(plot.left + width - plot.right) / 2} y={height - 12} textAnchor="middle">Date</text>
        <text className="axis-title" x={14} y={(plot.top + height - plot.bottom) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(plot.top + height - plot.bottom) / 2})`}>Growth CAGR</text>
        {realizedPartialPoints && <polyline points={realizedPartialPoints} fill="none" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="2,3" />}
        {realizedFullPoints && <polyline points={realizedFullPoints} fill="none" stroke="#7c3aed" strokeWidth={1.5} strokeDasharray="5,3" />}
        <polyline points={impliedPoints} fill="none" stroke="#2563eb" strokeWidth={2.2} />
      </svg>
      <div className="chart-legend">
        <span><i style={{ background: "#2563eb" }} />Priced-in growth</span>
        {visibleRealizedGrowth.length > 0 && <span><i style={{ background: "#7c3aed" }} />Realized growth</span>}
      </div>
      <p style={{ fontSize: 11, color: "#5b6258" }}>{firstDate} — {lastDate}</p>
    </div>
  );
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

function formatAxisDate(value: string): string {
  const date = new Date(value + "T00:00:00.000Z");
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
}

function axisDateMs(value: string): number {
  return new Date(value + "T00:00:00.000Z").getTime();
}

function chartDateTickIndexes(total: number): number[] {
  if (total <= 1) return [0];
  const targetTicks = Math.min(4, total);
  return Array.from({ length: targetTicks }, (_, index) => Math.round((index / (targetTicks - 1)) * (total - 1)))
    .filter((value, index, values) => values.indexOf(value) === index);
}

function chartTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count < 2) return [];
  if (min === max) return [min];
  const step = niceChartStep((max - min) / (count - 1));
  const tickMin = Math.floor(min / step) * step;
  const tickMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = tickMin; value <= tickMax + step / 2; value += step) {
    ticks.push(roundChartTick(value));
  }
  return ticks;
}

function niceChartStep(value: number): number {
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / Math.pow(10, exponent);
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * Math.pow(10, exponent);
}

function roundChartTick(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : Number(value.toPrecision(12));
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
