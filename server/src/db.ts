import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TRIAL_COMPANIES } from "@alphapane/shared";

const SEEDED_NAMES: Record<string, string> = {
  NASDAQ_MSFT: "Microsoft Corporation",
  NASDAQ_NVDA: "NVIDIA Corporation",
  NASDAQ_AMZN: "Amazon.com Inc.",
  NASDAQ_GOOG: "Alphabet Inc.",
  NASDAQ_TSLA: "Tesla Inc.",
  NYSE_LLY: "Eli Lilly and Company",
  NASDAQ_AVGO: "Broadcom Inc.",
  NYSE_V: "Visa Inc.",
  NYSE_MA: "Mastercard Inc.",
  NYSE_PG: "Procter & Gamble Company",
  NASDAQ_NFLX: "Netflix Inc.",
  NYSE_MCD: "McDonald's Corporation",
  NASDAQ_AMGN: "Amgen Inc.",
  NYSE_CAT: "Caterpillar Inc.",
  NYSE_UBER: "Uber Technologies Inc.",
  NYSE_MDT: "Medtronic plc",
  NYSE_DUK: "Duke Energy Corporation",
  NASDAQ_EQIX: "Equinix Inc.",
  NYSE_BRO: "Brown & Brown Inc.",
  NASDAQ_ZM: "Zoom Video Communications Inc.",
  NYSE_MKC: "McCormick & Company Inc.",
  NYSE_RYAN: "Ryan Specialty Group Holdings Inc.",
  NYSE_MOH: "Molina Healthcare Inc.",
  NYSE_CFG: "Citizens Financial Group Inc.",
  NYSE_JPM: "JPMorgan Chase & Co.",
  NASDAQ_ASML: "ASML Holding N.V.",
  NYSE_SHEL: "Shell plc",
  NYSE_SONY: "Sony Group Corporation",
  NYSE_CB: "Chubb Limited",
  NASDAQ_MELI: "MercadoLibre Inc.",
  TSX_CSU: "Constellation Software Inc.",
  TSX_ATD: "Alimentation Couche-Tard Inc.",
  TSX_DOL: "Dollarama Inc.",
  TSX_CLS: "Celestica Inc.",
  TSX_TFII: "TFI International Inc.",
  XPAR_MC: "LVMH Moet Hennessy Louis Vuitton",
  XSWX_NESN: "Nestle S.A.",
  XPAR_RMS: "Hermes International",
  XETR_SIE: "Siemens AG",
  XPAR_AIR: "Airbus SE",
  XPAR_SAF: "Safran SA",
  XPAR_DSY: "Dassault Systemes SE",
  XETR_RHM: "Rheinmetall AG",
  XLON_AT: "Ashtead Group plc",
  XLON_BME: "B&M European Value Retail S.A."
};

export function openDatabase(databasePath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  seedTrialCompanies(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      company_key TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      exchange TEXT NOT NULL,
      name TEXT NOT NULL,
      sector TEXT,
      industry TEXT,
      reporting_template TEXT,
      reporting_currency TEXT,
      trading_currency TEXT,
      terminal_url TEXT,
      caution TEXT,
      profile_json TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS market_snapshots (
      company_key TEXT PRIMARY KEY REFERENCES companies(company_key) ON DELETE CASCADE,
      share_price REAL,
      market_cap REAL,
      enterprise_value REAL,
      ev_to_revenue REAL,
      price_to_sales REAL,
      price_to_earnings REAL,
      ev_to_ebitda REAL,
      fcf_yield REAL,
      as_of_date TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS financial_snapshots (
      company_key TEXT PRIMARY KEY REFERENCES companies(company_key) ON DELETE CASCADE,
      latest_revenue REAL,
      latest_revenue_year INTEGER,
      latest_revenue_report_date TEXT,
      historical_revenue_cagr_5y REAL,
      normalized_fcf_margin_default REAL,
      normalized_fcf_margin_source TEXT,
      latest_revenue_source TEXT,
      historical_revenue_cagr_5y_source TEXT,
      exit_revenue_multiple_source TEXT,
      terminal_growth_default REAL,
      discount_rate_default REAL,
      exit_revenue_multiple_default REAL,
      revenue_history_json TEXT NOT NULL DEFAULT '[]',
      fcf_history_json TEXT NOT NULL DEFAULT '[]',
      source_links_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS assumption_overrides (
      company_key TEXT PRIMARY KEY REFERENCES companies(company_key) ON DELETE CASCADE,
      normalized_fcf_margin REAL,
      discount_rate REAL,
      terminal_growth REAL,
      exit_revenue_multiple REAL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_company_state (
      company_key TEXT PRIMARY KEY REFERENCES companies(company_key) ON DELETE CASCADE,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS model_outputs (
      company_key TEXT PRIMARY KEY REFERENCES companies(company_key) ON DELETE CASCADE,
      implied_revenue_cagr REAL,
      implied_revenue_cagr_exit REAL,
      cagr_gap REAL,
      signal TEXT NOT NULL DEFAULT 'insufficient data',
      model_grid_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'insufficient-data',
      status_message TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS valuation_snapshots (
      company_key TEXT PRIMARY KEY REFERENCES companies(company_key) ON DELETE CASCADE,
      metrics_json TEXT NOT NULL DEFAULT '{}',
      pe_history_json TEXT NOT NULL DEFAULT '[]',
      pe_band_levels_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      message TEXT
    );
  `);
  addColumnIfMissing(db, 'market_snapshots', 'ev_to_ebitda', 'REAL');
  addColumnIfMissing(db, 'market_snapshots', 'fcf_yield', 'REAL');
  addColumnIfMissing(db, 'financial_snapshots', 'normalized_fcf_margin_source', 'TEXT');
  addColumnIfMissing(db, 'financial_snapshots', 'latest_revenue_source', 'TEXT');
  addColumnIfMissing(db, 'financial_snapshots', 'historical_revenue_cagr_5y_source', 'TEXT');
  addColumnIfMissing(db, 'financial_snapshots', 'exit_revenue_multiple_source', 'TEXT');
}

function addColumnIfMissing(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

function seedTrialCompanies(db: DatabaseSync): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO companies (company_key, ticker, exchange, name, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const companyKey of TRIAL_COMPANIES) {
    const [exchange, ticker] = companyKey.split("_");
    insert.run(companyKey, ticker, exchange, SEEDED_NAMES[companyKey] ?? ticker, now);
  }
}

