import express from "express";
import cors from "cors";
import type { DatabaseSync } from "node:sqlite";
import {
  getColumnPreferences,
  getCompanyDetail,
  getCompanyRows,
  getImpliedGrowthHistoryData,
  getRefreshRuns,
  getValuationDetail,
  getValuationRows,
  saveAssumptions,
  saveColumnPreferences,
  saveCompanyState
} from "./repository.js";
import { refreshFinancials, refreshPrices } from "./refresh.js";

export function createApp(db: DatabaseSync) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/companies", (_req, res) => {
    res.json({ rows: getCompanyRows(db), columns: getColumnPreferences(db, "reverseDcfColumns") });
  });

  app.get("/api/companies/:companyKey", (req, res) => {
    const detail = getCompanyDetail(db, req.params.companyKey);
    if (!detail) {
      res.status(404).json({ error: "Company not found." });
      return;
    }
    res.json(detail);
  });

  app.get("/api/companies/:companyKey/implied-growth-history", (req, res) => {
    const data = getImpliedGrowthHistoryData(db, req.params.companyKey);
    if (!data) {
      res.status(404).json({ error: "No implied growth history data available." });
      return;
    }
    res.json(data);
  });

  app.get("/api/valuation/companies", (_req, res) => {
    res.json({ rows: getValuationRows(db), columns: getColumnPreferences(db, "historicalValuationColumns") });
  });

  app.get("/api/valuation/companies/:companyKey", (req, res) => {
    const detail = getValuationDetail(db, req.params.companyKey);
    if (!detail) {
      res.status(404).json({ error: "Company not found." });
      return;
    }
    res.json(detail);
  });

  app.patch("/api/companies/:companyKey/state", (req, res) => {
    saveCompanyState(db, req.params.companyKey, {
      isFavorite: typeof req.body.isFavorite === "boolean" ? req.body.isFavorite : undefined,
      note: typeof req.body.note === "string" ? req.body.note : undefined
    });
    res.json(getCompanyDetail(db, req.params.companyKey));
  });

  app.patch("/api/companies/:companyKey/assumptions", (req, res) => {
    saveAssumptions(db, req.params.companyKey, {
      basePeriod: cleanBasePeriod(req.body.basePeriod),
      normalizedFcfMargin: cleanPercent(req.body.normalizedFcfMargin),
      discountRate: cleanPercent(req.body.discountRate),
      terminalGrowth: cleanPercent(req.body.terminalGrowth),
      terminalMethod: cleanTerminalMethod(req.body.terminalMethod),
      exitMetric: cleanExitMetric(req.body.exitMetric),
      exitMultiple: cleanPercent(req.body.exitMultiple),
      normalizedEbitdaMargin: cleanPercent(req.body.normalizedEbitdaMargin)
    });
    res.json(getCompanyDetail(db, req.params.companyKey));
  });

  app.patch("/api/preferences/columns", (req, res) => {
    const columns = Array.isArray(req.body.columns) ? req.body.columns : [];
    const key = req.body.key === "historicalValuationColumns" ? "historicalValuationColumns" : "reverseDcfColumns";
    saveColumnPreferences(db, columns, key);
    res.json({ columns: getColumnPreferences(db, key) });
  });

  app.get("/api/refresh-runs", (_req, res) => {
    res.json({ runs: getRefreshRuns(db) });
  });

  app.post("/api/refresh/prices", async (_req, res) => {
    try {
      await refreshPrices(db);
      res.json({ ok: true, rows: getCompanyRows(db), valuationRows: getValuationRows(db), runs: getRefreshRuns(db) });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error), runs: getRefreshRuns(db) });
    }
  });

  app.post("/api/refresh/financials", async (_req, res) => {
    try {
      await refreshFinancials(db);
      res.json({ ok: true, rows: getCompanyRows(db), valuationRows: getValuationRows(db), runs: getRefreshRuns(db) });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error), runs: getRefreshRuns(db) });
    }
  });

  return app;
}

function cleanBasePeriod(value: unknown): "ltm" | "annual" | null | undefined {
  if (value === null) return null;
  if (value === undefined || value === "") return undefined;
  return value === "ltm" || value === "annual" ? value : undefined;
}

function cleanPercent(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function cleanTerminalMethod(value: unknown): "perpetuity" | "exit-multiple" | undefined {
  return value === "perpetuity" || value === "exit-multiple" ? value : undefined;
}

function cleanExitMetric(value: unknown): "fcf" | "ebitda" | "revenue" | undefined {
  return value === "fcf" || value === "ebitda" || value === "revenue" ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
