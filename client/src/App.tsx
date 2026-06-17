import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDownUp, ChevronLeft, ChevronRight, Columns3, DatabaseZap, RefreshCw, Search, Star } from "lucide-react";
import type { ColumnPreference, CompanyDetail, CompanyRow, ModelCell, RefreshRun } from "@alphapane/shared";

interface TableColumn {
  key: keyof CompanyRow | "actions";
  label: string;
  align?: "left" | "right" | "center";
  render: (row: CompanyRow) => string | ReactNode;
  sortValue?: (row: CompanyRow) => string | number | null | boolean;
}

const columns: TableColumn[] = [
  {
    key: "actions",
    label: "",
    align: "center",
    render: (row) => <FavoriteButton row={row} />
  },
  { key: "ticker", label: "Ticker", render: (row) => row.ticker, sortValue: (row) => row.ticker },
  { key: "name", label: "Company", render: (row) => row.name, sortValue: (row) => row.name },
  { key: "sector", label: "Sector", render: (row) => row.sector ?? "-", sortValue: (row) => row.sector },
  { key: "sharePrice", label: "Price", align: "right", render: (row) => money(row.sharePrice), sortValue: (row) => row.sharePrice },
  { key: "enterpriseValue", label: "EV", align: "right", render: (row) => compactMoney(row.enterpriseValue), sortValue: (row) => row.enterpriseValue },
  { key: "latestRevenue", label: "Revenue", align: "right", render: (row) => compactMoney(row.latestRevenue), sortValue: (row) => row.latestRevenue },
  { key: "evToRevenue", label: "EV/Rev", align: "right", render: (row) => multiple(row.evToRevenue), sortValue: (row) => row.evToRevenue },
  {
    key: "historicalRevenueCagr5y",
    label: "Hist 5Y CAGR",
    align: "right",
    render: (row) => percent(row.historicalRevenueCagr5y),
    sortValue: (row) => row.historicalRevenueCagr5y
  },
  {
    key: "normalizedFcfMargin",
    label: "FCF Margin",
    align: "right",
    render: (row) => percent(row.normalizedFcfMargin),
    sortValue: (row) => row.normalizedFcfMargin
  },
  {
    key: "normalizedFcfMarginSource",
    label: "FCF Source",
    render: (row) => row.normalizedFcfMarginSource ?? "-",
    sortValue: (row) => row.normalizedFcfMarginSource
  },
  {
    key: "discountRate",
    label: "Discount",
    align: "right",
    render: (row) => percent(row.discountRate),
    sortValue: (row) => row.discountRate
  },
  {
    key: "terminalGrowth",
    label: "Terminal",
    align: "right",
    render: (row) => percent(row.terminalGrowth),
    sortValue: (row) => row.terminalGrowth
  },
  {
    key: "impliedRevenueCagr",
    label: "Priced-In CAGR",
    align: "right",
    render: (row) => strong(percent(row.impliedRevenueCagr)),
    sortValue: (row) => row.impliedRevenueCagr
  },
  {
    key: "impliedRevenueCagrExit",
    label: "Exit CAGR",
    align: "right",
    render: (row) => percent(row.impliedRevenueCagrExit),
    sortValue: (row) => row.impliedRevenueCagrExit
  },
  { key: "cagrGap", label: "Gap", align: "right", render: (row) => percent(row.cagrGap), sortValue: (row) => row.cagrGap },
  { key: "signal", label: "Signal", render: (row) => <SignalPill signal={row.signal} />, sortValue: (row) => row.signal },
  {
    key: "financialsUpdatedAt",
    label: "Financials",
    render: (row) => dateShort(row.financialsUpdatedAt),
    sortValue: (row) => row.financialsUpdatedAt
  },
  {
    key: "pricesUpdatedAt",
    label: "Prices",
    render: (row) => dateShort(row.pricesUpdatedAt),
    sortValue: (row) => row.pricesUpdatedAt
  },
  {
    key: "note",
    label: "Note",
    render: (row) => (row.note.trim() ? "Yes" : "-"),
    sortValue: (row) => row.note
  }
];

// The "actions" column (favorite star) is pinned to the far left and is not reorderable.
const columnByKey = new Map(columns.map((column) => [String(column.key), column]));
const defaultColumnOrder = columns.filter((column) => column.key !== "actions").map((column) => String(column.key));

export function App() {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [preferences, setPreferences] = useState<ColumnPreference[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [runs, setRuns] = useState<RefreshRun[]>([]);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortKey, setSortKey] = useState<string>("impliedRevenueCagr");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (!selectedKey) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedKey);
  }, [selectedKey]);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const payload = await api<{ rows: CompanyRow[]; columns: ColumnPreference[] }>("/api/companies");
      setRows(payload.rows);
      setPreferences(payload.columns);
      if (!selectedKey && payload.rows[0]) setSelectedKey(payload.rows[0].companyKey);
      const refreshPayload = await api<{ runs: RefreshRun[] }>("/api/refresh-runs");
      setRuns(refreshPayload.runs);
    } catch (apiError) {
      setError(errorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(companyKey: string) {
    try {
      const payload = await api<CompanyDetail>(`/api/companies/${companyKey}`);
      setDetail(payload);
    } catch (apiError) {
      setError(errorMessage(apiError));
    }
  }

  async function runRefresh(kind: "prices" | "financials") {
    setRefreshing(kind);
    setError(null);
    try {
      const payload = await api<{ rows: CompanyRow[]; runs: RefreshRun[] }>(`/api/refresh/${kind}`, { method: "POST" });
      setRows(payload.rows);
      setRuns(payload.runs);
      if (selectedKey) await loadDetail(selectedKey);
    } catch (apiError) {
      setError(errorMessage(apiError));
      const refreshPayload = await api<{ runs: RefreshRun[] }>("/api/refresh-runs");
      setRuns(refreshPayload.runs);
    } finally {
      setRefreshing(null);
    }
  }

  const hiddenKeys = useMemo(
    () => new Set(preferences.filter((pref) => pref.visible === false).map((pref) => pref.key)),
    [preferences]
  );

  // Column order is driven by the saved preferences. Keys not yet present (e.g. newly added
  // columns) fall back to their default position at the end.
  const orderedKeys = useMemo(() => {
    const seen = new Set<string>();
    const fromPreferences: string[] = [];
    for (const pref of preferences) {
      if (columnByKey.has(pref.key) && pref.key !== "actions" && !seen.has(pref.key)) {
        seen.add(pref.key);
        fromPreferences.push(pref.key);
      }
    }
    const missing = defaultColumnOrder.filter((key) => !seen.has(key));
    return [...fromPreferences, ...missing];
  }, [preferences]);

  function persistColumns(nextOrderedKeys: string[], nextHidden: Set<string>) {
    const next = nextOrderedKeys.map((key) => ({ key, visible: !nextHidden.has(key) }));
    setPreferences(next);
    return api("/api/preferences/columns", {
      method: "PATCH",
      body: JSON.stringify({ columns: next })
    });
  }

  async function toggleColumn(key: string) {
    const nextHidden = new Set(hiddenKeys);
    if (nextHidden.has(key)) nextHidden.delete(key);
    else nextHidden.add(key);
    await persistColumns(orderedKeys, nextHidden);
  }

  async function moveColumn(key: string, direction: -1 | 1) {
    const keys = [...orderedKeys];
    const from = keys.indexOf(key);
    if (from === -1) return;
    // Swap with the nearest visible neighbour so the move matches what the user sees.
    let to = from + direction;
    while (to >= 0 && to < keys.length && hiddenKeys.has(keys[to])) to += direction;
    if (to < 0 || to >= keys.length) return;
    [keys[from], keys[to]] = [keys[to], keys[from]];
    await persistColumns(keys, hiddenKeys);
  }

  const orderedColumns = useMemo(() => {
    const actions = columns.filter((column) => column.key === "actions");
    const ordered = orderedKeys.map((key) => columnByKey.get(key)).filter((column): column is TableColumn => Boolean(column));
    return [...actions, ...ordered];
  }, [orderedKeys]);

  const visibleColumns = orderedColumns.filter((column) => column.key === "actions" || !hiddenKeys.has(String(column.key)));
  const visibleReorderableKeys = visibleColumns.filter((column) => column.key !== "actions").map((column) => String(column.key));
  const firstReorderableKey = visibleReorderableKeys[0];
  const lastReorderableKey = visibleReorderableKeys[visibleReorderableKeys.length - 1];
  const filteredRows = useMemo(() => {
    const text = query.trim().toLowerCase();
    const column = columns.find((item) => String(item.key) === sortKey);
    return rows
      .filter((row) => !favoritesOnly || row.isFavorite)
      .filter((row) => !text || `${row.ticker} ${row.name} ${row.sector ?? ""} ${row.signal}`.toLowerCase().includes(text))
      .sort((a, b) => compareValues(column?.sortValue?.(a) ?? null, column?.sortValue?.(b) ?? null, sortDirection));
  }, [rows, query, favoritesOnly, sortKey, sortDirection]);

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <h1>AlphaPane</h1>
          <p>Priced-in 5-year revenue CAGR from enterprise value and cached Fiscal financials.</p>
        </div>
        <div className="actions">
          <button onClick={() => void runRefresh("prices")} disabled={Boolean(refreshing)}>
            <RefreshCw size={16} />
            {refreshing === "prices" ? "Refreshing" : "Refresh Prices"}
          </button>
          <button onClick={() => void runRefresh("financials")} disabled={Boolean(refreshing)}>
            <DatabaseZap size={16} />
            {refreshing === "financials" ? "Refreshing" : "Refresh Financials"}
          </button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <main className="layout">
        <section className="table-section">
          <div className="toolbar">
            <label className="search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticker, company, sector, signal" />
            </label>
            <label className="check">
              <input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />
              Favorites
            </label>
            <details className="columns-menu">
              <summary>
                <Columns3 size={16} />
                Columns
              </summary>
              <div>
                {orderedColumns
                  .filter((column) => column.key !== "actions")
                  .map((column) => (
                    <label key={String(column.key)}>
                      <input
                        type="checkbox"
                        checked={!hiddenKeys.has(String(column.key))}
                        onChange={() => void toggleColumn(String(column.key))}
                      />
                      {column.label}
                    </label>
                  ))}
              </div>
            </details>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {visibleColumns.map((column) => {
                    const key = String(column.key);
                    const reorderable = column.key !== "actions";
                    return (
                      <th key={key} className={column.align ?? "left"}>
                        <div className={`th-inner ${column.align ?? "left"}`}>
                          {reorderable && (
                            <button
                              className="move-button"
                              title="Move column left"
                              aria-label={`Move ${column.label} column left`}
                              disabled={key === firstReorderableKey}
                              onClick={() => void moveColumn(key, -1)}
                            >
                              <ChevronLeft size={13} />
                            </button>
                          )}
                          <button
                            className="sort-button"
                            onClick={() => {
                              if (sortKey === key) setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                              else setSortKey(key);
                            }}
                          >
                            {column.label}
                            {reorderable && <ArrowDownUp size={12} />}
                          </button>
                          {reorderable && (
                            <button
                              className="move-button"
                              title="Move column right"
                              aria-label={`Move ${column.label} column right`}
                              disabled={key === lastReorderableKey}
                              onClick={() => void moveColumn(key, 1)}
                            >
                              <ChevronRight size={13} />
                            </button>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={visibleColumns.length}>Loading local cache...</td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.companyKey} className={selectedKey === row.companyKey ? "selected" : ""} onClick={() => setSelectedKey(row.companyKey)}>
                      {visibleColumns.map((column) => (
                        <td key={String(column.key)} className={column.align ?? "left"}>
                          {column.render(row)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="detail-panel">{detail ? <DetailView detail={detail} onSaved={loadDashboard} /> : <EmptyDetail runs={runs} />}</aside>
      </main>
    </div>
  );
}

function DetailView({ detail, onSaved }: { detail: CompanyDetail; onSaved: () => Promise<void> }) {
  const [note, setNote] = useState(detail.row.note);
  const [assumptions, setAssumptions] = useState({
    normalizedFcfMargin: detail.overrides.normalizedFcfMargin ?? detail.defaults.normalizedFcfMargin,
    discountRate: detail.overrides.discountRate ?? detail.defaults.discountRate,
    terminalGrowth: detail.overrides.terminalGrowth ?? detail.defaults.terminalGrowth,
    exitRevenueMultiple: detail.overrides.exitRevenueMultiple ?? detail.defaults.exitRevenueMultiple
  });

  useEffect(() => {
    setNote(detail.row.note);
    setAssumptions({
      normalizedFcfMargin: detail.overrides.normalizedFcfMargin ?? detail.defaults.normalizedFcfMargin,
      discountRate: detail.overrides.discountRate ?? detail.defaults.discountRate,
      terminalGrowth: detail.overrides.terminalGrowth ?? detail.defaults.terminalGrowth,
      exitRevenueMultiple: detail.overrides.exitRevenueMultiple ?? detail.defaults.exitRevenueMultiple
    });
  }, [detail]);

  async function saveNote() {
    await api(`/api/companies/${detail.row.companyKey}/state`, {
      method: "PATCH",
      body: JSON.stringify({ note })
    });
    await onSaved();
  }

  async function saveAssumptions() {
    await api(`/api/companies/${detail.row.companyKey}/assumptions`, {
      method: "PATCH",
      body: JSON.stringify(assumptions)
    });
    await onSaved();
  }

  return (
    <>
      <div className="detail-header">
        <div>
          <h2>{detail.row.ticker}</h2>
          <p>{detail.row.name}</p>
        </div>
        <SignalPill signal={detail.row.signal} />
      </div>

      {detail.row.caution && <div className="caution">{detail.row.caution}</div>}

      <div className="metrics-strip">
        <Metric label="Priced-In CAGR" value={percent(detail.row.impliedRevenueCagr)} />
        <Metric label="History" value={percent(detail.row.historicalRevenueCagr5y)} />
        <Metric label="Gap" value={percent(detail.row.cagrGap)} />
        <Metric label="EV/Rev" value={multiple(detail.row.evToRevenue)} />
      </div>

      <section className="section">
        <h3>Assumptions</h3>
        <div className="assumption-grid">
          <InputPercent label="FCF margin" value={assumptions.normalizedFcfMargin} onChange={(value) => setAssumptions({ ...assumptions, normalizedFcfMargin: value })} />
          <InputPercent label="Discount rate" value={assumptions.discountRate} onChange={(value) => setAssumptions({ ...assumptions, discountRate: value })} />
          <InputPercent label="Terminal growth" value={assumptions.terminalGrowth} onChange={(value) => setAssumptions({ ...assumptions, terminalGrowth: value })} />
          <label>
            Exit revenue multiple
            <input
              type="number"
              step="0.1"
              value={assumptions.exitRevenueMultiple ?? ""}
              onChange={(event) => setAssumptions({ ...assumptions, exitRevenueMultiple: parseInputNumber(event.target.value) })}
            />
          </label>
        </div>
        <button className="primary-action" onClick={() => void saveAssumptions()}>
          Save assumptions
        </button>
      </section>

      <section className="section">
        <h3>Default Sources</h3>
        <div className="source-grid">
          <Metric label="Revenue" value={detail.sources.latestRevenue ?? "-"} />
          <Metric label="FCF margin" value={detail.sources.normalizedFcfMargin ?? "-"} />
          <Metric label="History CAGR" value={detail.sources.historicalRevenueCagr5y ?? "-"} />
          <Metric label="Exit multiple" value={detail.sources.exitRevenueMultiple ?? "-"} />
        </div>
      </section>

      <section className="section">
        <h3>Model Grid</h3>
        <div className="model-grid-wrap">
          <table className="model-grid">
            <thead>
              <tr>
                <th>Line item</th>
                {detail.gridColumns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.gridRows.map((row) => (
                <tr key={row.label}>
                  <td>
                    <span className={`kind ${row.kind}`}>{row.kind}</span>
                    {row.label}
                  </td>
                  {detail.gridColumns.map((_, index) => (
                    <td key={index}>{formatCell(row, row.values[index])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h3>Note / Thesis</h3>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Short investment note or thesis..." />
        <button className="primary-action" onClick={() => void saveNote()}>
          Save note
        </button>
      </section>

      <section className="section source-section">
        <h3>Sources</h3>
        {detail.sourceLinks.length === 0 ? (
          <p>No filing source links cached yet.</p>
        ) : (
          detail.sourceLinks.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ))
        )}
        {detail.row.terminalUrl && (
          <a href={detail.row.terminalUrl} target="_blank" rel="noreferrer">
            View in Fiscal
          </a>
        )}
      </section>
    </>
  );
}

function EmptyDetail({ runs }: { runs: RefreshRun[] }) {
  return (
    <div className="empty-detail">
      <h2>No company selected</h2>
      <p>Select a ticker to inspect the reverse DCF model grid.</p>
      <h3>Recent refreshes</h3>
      {runs.length === 0 ? (
        <p>No refresh runs yet.</p>
      ) : (
        runs.map((run) => (
          <div key={run.id} className="run-row">
            <span>{run.kind}</span>
            <strong>{run.status}</strong>
            <time>{dateShort(run.finishedAt ?? run.startedAt)}</time>
          </div>
        ))
      )}
    </div>
  );
}

function FavoriteButton({ row }: { row: CompanyRow }) {
  const [favorite, setFavorite] = useState(row.isFavorite);
  useEffect(() => setFavorite(row.isFavorite), [row.isFavorite]);
  return (
    <button
      className={`icon-button ${favorite ? "active" : ""}`}
      title={favorite ? "Remove favorite" : "Add favorite"}
      onClick={async (event) => {
        event.stopPropagation();
        const next = !favorite;
        setFavorite(next);
        await api(`/api/companies/${row.companyKey}/state`, {
          method: "PATCH",
          body: JSON.stringify({ isFavorite: next })
        });
      }}
    >
      <Star size={16} />
    </button>
  );
}

function SignalPill({ signal }: { signal: CompanyRow["signal"] }) {
  const className = signal.includes("low") ? "low" : signal.includes("high") ? "high" : signal.includes("near") ? "near" : "missing";
  return <span className={`signal ${className}`}>{signal}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InputPercent({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <label>
      {label}
      <input type="number" step="0.1" value={value === null ? "" : (value * 100).toFixed(1)} onChange={(event) => onChange(parseInputPercent(event.target.value))} />
    </label>
  );
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
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

function dateShort(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function strong(value: string) {
  return <strong>{value}</strong>;
}

function parseInputPercent(value: string): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number / 100 : null;
}

function parseInputNumber(value: string): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

