import { describe, expect, it } from "vitest";
import { solveImpliedGrowth, computeRealizedGrowth, cagr } from "@alphapane/shared";
import { buildModel } from "./math.js";

describe("solveImpliedGrowth (shared solver)", () => {
  const baseInputs = {
    enterpriseValue: 1800,
    baseRevenue: 100,
    normalizedFcfMargin: 0.25,
    discountRate: 0.1,
    terminalGrowth: 0.03,
    historicalRevenueCagr5y: 0.08
  } as const;

  it("produces the same CAGR as buildModel for identical inputs", () => {
    const sharedResult = solveImpliedGrowth(baseInputs);
    const serverResult = buildModel(baseInputs).impliedRevenueCagr;
    expect(sharedResult).not.toBeNull();
    expect(sharedResult).toBeCloseTo(serverResult as number, 6);
  });

  it("matches buildModel in exit-multiple mode", () => {
    const inputs = {
      ...baseInputs,
      terminalMethod: "exit-multiple" as const,
      exitMetric: "fcf" as const,
      exitMultiple: 20
    };
    const sharedResult = solveImpliedGrowth(inputs);
    const serverResult = buildModel(inputs).impliedRevenueCagr;
    expect(sharedResult).not.toBeNull();
    expect(sharedResult).toBeCloseTo(serverResult as number, 6);
  });

  it("returns null when required inputs are missing", () => {
    expect(solveImpliedGrowth({ ...baseInputs, enterpriseValue: null })).toBeNull();
    expect(solveImpliedGrowth({ ...baseInputs, baseRevenue: null })).toBeNull();
    expect(solveImpliedGrowth({ ...baseInputs, normalizedFcfMargin: null })).toBeNull();
    expect(solveImpliedGrowth({ ...baseInputs, discountRate: null })).toBeNull();
  });

  it("returns null when discount rate <= terminal growth (perpetuity)", () => {
    expect(solveImpliedGrowth({ ...baseInputs, discountRate: 0.03, terminalGrowth: 0.04 })).toBeNull();
  });

  it("returns null when growth is out of range", () => {
    expect(solveImpliedGrowth({ ...baseInputs, enterpriseValue: 1_000_000_000 })).toBeNull();
    expect(solveImpliedGrowth({ ...baseInputs, enterpriseValue: 1 })).toBeNull();
  });

  it("handles exit-multiple with EBITDA metric", () => {
    const result = solveImpliedGrowth({
      ...baseInputs,
      terminalMethod: "exit-multiple",
      exitMetric: "ebitda",
      exitMultiple: 12,
      normalizedEbitdaMargin: 0.3
    });
    const serverResult = buildModel({
      ...baseInputs,
      terminalMethod: "exit-multiple",
      exitMetric: "ebitda",
      exitMultiple: 12,
      normalizedEbitdaMargin: 0.3
    }).impliedRevenueCagr;
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(serverResult as number, 6);
  });
});

describe("computeRealizedGrowth", () => {
  it("computes 5Y CAGR when 5 years of future data exist", () => {
    const timeline = [
      { reportDate: "2019-12-31", revenue: 100 },
      { reportDate: "2020-12-31", revenue: 110 },
      { reportDate: "2021-12-31", revenue: 120 },
      { reportDate: "2022-12-31", revenue: 130 },
      { reportDate: "2023-12-31", revenue: 140 },
      { reportDate: "2024-12-31", revenue: 161.05 }
    ];
    const result = computeRealizedGrowth(timeline);
    expect(result).toHaveLength(6);
    expect(result[0].isPartial).toBe(false);
    expect(result[0].realizedCagr).toBeCloseTo(cagr(100, 161.05, 5)!, 4);
  });

  it("marks recent points as partial when <5 years of future data", () => {
    const timeline = [
      { reportDate: "2020-12-31", revenue: 100 },
      { reportDate: "2021-12-31", revenue: 120 },
      { reportDate: "2022-12-31", revenue: 130 }
    ];
    const result = computeRealizedGrowth(timeline);
    expect(result[0].isPartial).toBe(true);
    expect(result[0].realizedCagr).toBeCloseTo(cagr(100, 130, 2)!, 4);
    expect(result[1].isPartial).toBe(true);
    expect(result[2].isPartial).toBe(true);
    expect(result[2].realizedCagr).toBeNull();
  });

  it("handles a single data point", () => {
    const result = computeRealizedGrowth([{ reportDate: "2024-12-31", revenue: 100 }]);
    expect(result).toHaveLength(1);
    expect(result[0].isPartial).toBe(true);
    expect(result[0].realizedCagr).toBeNull();
  });

  it("filters out non-positive revenue values", () => {
    const timeline = [
      { reportDate: "2019-12-31", revenue: 0 },
      { reportDate: "2020-12-31", revenue: 100 },
      { reportDate: "2024-12-31", revenue: 161.05 }
    ];
    const result = computeRealizedGrowth(timeline);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe("2020-12-31");
  });
});

describe("point-in-time revenue step function (no look-ahead)", () => {
  it("uses the most recent reported revenue for a given date", () => {
    const sortedRevenue = [
      { reportDate: "2020-12-31", revenue: 100 },
      { reportDate: "2022-12-31", revenue: 200 }
    ];
    const pointInTime = (date: string) => {
      let result: number | null = null;
      for (const point of sortedRevenue) {
        if (point.reportDate <= date) result = point.revenue;
        else break;
      }
      return result;
    };
    expect(pointInTime("2020-01-01")).toBeNull();
    expect(pointInTime("2021-06-30")).toBe(100);
    expect(pointInTime("2022-12-31")).toBe(200);
    expect(pointInTime("2023-01-01")).toBe(200);
  });
});
