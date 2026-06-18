import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRIAL_COMPANIES } from "@alphapane/shared";
import { openDatabase } from "./db.js";
import { buildEvBridge, buildFinancialBases, refreshBatch } from "./refresh.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mock Fiscal client that records dedup/concurrency behavior. companyKey is always the first arg. */
function makeTrackingClient(options: { failKey?: string } = {}) {
  const liveCalls = new Map<string, number>();
  const stockPriceCalls = new Map<string, number>();
  const attempted = new Set<string>();
  let activeCompanies = 0;
  let maxConcurrentCompanies = 0;

  async function track<T>(companyKey: string, value: T): Promise<T> {
    attempted.add(companyKey);
    const live = liveCalls.get(companyKey) ?? 0;
    if (live === 0) {
      activeCompanies += 1;
      maxConcurrentCompanies = Math.max(maxConcurrentCompanies, activeCompanies);
    }
    liveCalls.set(companyKey, live + 1);
    try {
      await delay(5);
      if (options.failKey && companyKey === options.failKey) throw new Error(`forced failure for ${companyKey}`);
      return value;
    } finally {
      const remaining = (liveCalls.get(companyKey) ?? 1) - 1;
      liveCalls.set(companyKey, remaining);
      if (remaining === 0) activeCompanies -= 1;
    }
  }

  const client = {
    async companyProfile(companyKey: string) {
      return track(companyKey, { name: "Bench Co", sector: "Technology", reportingTemplate: "standard" });
    },
    async companyRatios(companyKey: string) {
      return track(companyKey, { data: [{ periodType: "Latest", reportDate: "2024-12-31", metricValues: {} }] });
    },
    async standardizedFinancials(companyKey: string) {
      return track(companyKey, { data: [] });
    },
    async dailyRatio(companyKey: string) {
      return track(companyKey, [] as Array<Record<string, unknown>>);
    },
    async stockPrices(companyKey: string) {
      stockPriceCalls.set(companyKey, (stockPriceCalls.get(companyKey) ?? 0) + 1);
      return track(companyKey, [] as any[]);
    }
  };

  return {
    client: client as any,
    stockPriceCalls,
    attempted,
    maxConcurrentCompanies: () => maxConcurrentCompanies
  };
}

describe("refreshBatch concurrency pool", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;
  const priorConcurrency = process.env.REFRESH_CONCURRENCY;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `alphapane-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
    db = openDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    if (priorConcurrency === undefined) delete process.env.REFRESH_CONCURRENCY;
    else process.env.REFRESH_CONCURRENCY = priorConcurrency;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${dbPath}${suffix}`);
      } catch {
        /* best effort */
      }
    }
  });

  it("fetches stock prices once per company during a prices refresh", async () => {
    process.env.REFRESH_CONCURRENCY = "3";
    const tracker = makeTrackingClient();
    const companyKeys = [...TRIAL_COMPANIES].slice(0, 6);

    const result = await refreshBatch(db, { kind: "prices", companyKeys, order: "given", continueOnError: true }, tracker.client);

    expect(result.status).toBe("success");
    for (const companyKey of companyKeys) {
      expect(tracker.stockPriceCalls.get(companyKey)).toBe(1);
    }
  });

  it("never runs more companies in parallel than the configured concurrency", async () => {
    process.env.REFRESH_CONCURRENCY = "3";
    const tracker = makeTrackingClient();
    const companyKeys = [...TRIAL_COMPANIES].slice(0, 8);

    await refreshBatch(db, { kind: "prices", companyKeys, order: "given", continueOnError: true }, tracker.client);

    expect(tracker.maxConcurrentCompanies()).toBeLessThanOrEqual(3);
    expect(tracker.maxConcurrentCompanies()).toBeGreaterThan(1);
  });

  it("stops scheduling new companies after a failure when continueOnError is false", async () => {
    process.env.REFRESH_CONCURRENCY = "1";
    const companyKeys = [...TRIAL_COMPANIES].slice(0, 4);
    const tracker = makeTrackingClient({ failKey: companyKeys[0] });

    const result = await refreshBatch(db, { kind: "prices", companyKeys, order: "given", continueOnError: false }, tracker.client);

    expect(result.status).not.toBe("success");
    expect(tracker.attempted.size).toBe(1);
    expect(tracker.attempted.has(companyKeys[0])).toBe(true);
  });
});

describe("financial base derivation", () => {
  it("builds LTM and annual revenue and FCF bases", () => {
    const incomeRows = [
      { periodType: "Annual", reportDate: "2024-12-31", calendarYear: 2024, metricsValues: { income_statement_total_revenues: { value: 900 } } },
      { periodType: "LTM", reportDate: "2025-09-30", calendarYear: 2025, metricsValues: { income_statement_total_revenues: { value: 1200 } } }
    ];
    const cashFlowRows = [
      { periodType: "Annual", reportDate: "2024-12-31", calendarYear: 2024, metricsValues: { cash_flow_statement_net_cash_from_operating_activities: { value: 240 }, cash_flow_statement_purchases_of_property_plant_and_equipment: { value: -60 } } },
      { periodType: "LTM", reportDate: "2025-09-30", calendarYear: 2025, metricsValues: { cash_flow_statement_net_cash_from_operating_activities: { value: 330 }, cash_flow_statement_purchases_of_property_plant_and_equipment: { value: -90 } } }
    ];

    const bases = buildFinancialBases(incomeRows, cashFlowRows);

    expect(bases.ltm?.revenue).toBe(1200);
    expect(bases.ltm?.fcf).toBe(240);
    expect(bases.ltm?.fcfMargin).toBeCloseTo(0.2);
    expect(bases.annual?.revenue).toBe(900);
    expect(bases.annual?.fcf).toBe(180);
    expect(bases.annual?.fcfMargin).toBeCloseTo(0.2);
  });
});

describe("EV bridge derivation", () => {
  it("rebuilds enterprise value from balance sheet components", () => {
    const bridge = buildEvBridge([
      {
        periodType: "Quarterly",
        reportDate: "2025-09-30",
        calendarYear: 2025,
        metricsValues: {
          balance_sheet_total_cash_and_cash_equivalents: { value: 100 },
          balance_sheet_short_term_debt: { value: 40 },
          balance_sheet_long_term_debt: { value: 160 },
          balance_sheet_preferred_stock: { value: 10 },
          balance_sheet_minority_interests_and_other: { value: 5 }
        }
      }
    ], { calculated_market_cap: 1000, calculated_tev: 1115 });

    expect(bridge?.netDebt).toBe(100);
    expect(bridge?.rebuiltEnterpriseValue).toBe(1115);
    expect(bridge?.differencePercent).toBeCloseTo(0);
    expect(bridge?.warning).toBeNull();
  });

  it("flags material TEV bridge mismatches", () => {
    const bridge = buildEvBridge([
      {
        periodType: "Annual",
        reportDate: "2024-12-31",
        calendarYear: 2024,
        metricsValues: {
          balance_sheet_cash_and_cash_equivalents: { value: 50 },
          balance_sheet_long_term_debt: { value: 150 }
        }
      }
    ], { calculated_market_cap: 1000, calculated_tev: 900 });

    expect(bridge?.rebuiltEnterpriseValue).toBe(1100);
    expect(bridge?.differencePercent).toBeGreaterThan(0.05);
    expect(bridge?.warning).toContain("differs materially");
  });
});
