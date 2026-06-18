/**
 * Refresh benchmark with a mock Fiscal client.
 *
 * There is no live FISCAL_API_KEY in this environment, so we measure the structural speedup of the
 * refresh pipeline by replacing the HTTP client with a mock that simulates a fixed per-call network
 * latency. Every Fiscal endpoint sleeps for BENCH_LATENCY_MS and returns a minimal valid payload, so
 * wall-clock time reflects only how the pipeline schedules calls (serial vs concurrent), not the
 * trivial DB work.
 *
 * Env:
 *   BENCH_LATENCY_MS   per-call simulated latency (default 150)
 *   BENCH_KIND         "prices" | "financials" | "all" (default "prices")
 *   BENCH_COUNT        number of companies (default 8)
 *   REFRESH_CONCURRENCY consumed by the new pipeline; ignored by the old serial code
 *
 * Caveat: the mock imposes no server-side rate limit, so this measures the structural ceiling. Real
 * speedup is additionally bounded by Fiscal.ai's rate limit and the chosen REFRESH_CONCURRENCY.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { TRIAL_COMPANIES } from "@alphapane/shared";
import { openDatabase } from "./db.js";
import { refreshBatch } from "./refresh.js";

const LATENCY_MS = Number(process.env.BENCH_LATENCY_MS ?? 150);
const KIND = (process.env.BENCH_KIND ?? "prices") as "prices" | "financials" | "all";
const COUNT = Number(process.env.BENCH_COUNT ?? 8);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MockFiscalClient {
  async companyProfile(): Promise<Record<string, unknown>> {
    await delay(LATENCY_MS);
    return { name: "Bench Co", sector: "Technology", reportingTemplate: "standard" };
  }
  async companyRatios(): Promise<Record<string, unknown>> {
    await delay(LATENCY_MS);
    return { data: [{ periodType: "Latest", reportDate: "2024-12-31", metricValues: {} }] };
  }
  async standardizedFinancials(): Promise<Record<string, unknown>> {
    await delay(LATENCY_MS);
    return { data: [] };
  }
  async dailyRatio(): Promise<Array<Record<string, unknown>>> {
    await delay(LATENCY_MS);
    return [];
  }
  async stockPrices(): Promise<any[]> {
    await delay(LATENCY_MS);
    return [];
  }
}

const dbPath = path.join(os.tmpdir(), `alphapane-bench-${process.pid}-${Date.now()}.db`);
const db = openDatabase(dbPath);
const companyKeys = [...TRIAL_COMPANIES].slice(0, COUNT);
const client = new MockFiscalClient() as any;

const start = performance.now();
const result = await refreshBatch(db, { kind: KIND, companyKeys, order: "given", continueOnError: true }, client);
const elapsedMs = Math.round(performance.now() - start);

console.log(
  JSON.stringify({
    kind: KIND,
    companies: companyKeys.length,
    latencyMs: LATENCY_MS,
    concurrency: process.env.REFRESH_CONCURRENCY ?? "default(8)",
    status: result.status,
    elapsedMs
  })
);

for (const suffix of ["", "-wal", "-shm"]) {
  try {
    fs.rmSync(`${dbPath}${suffix}`);
  } catch {
    /* best effort */
  }
}
