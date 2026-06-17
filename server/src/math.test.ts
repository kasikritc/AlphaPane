import { describe, expect, it } from "vitest";
import { buildModel, buildSensitivity, cagr, defaultDiscountRate, deriveSignal, median } from "./math.js";

describe("math utilities", () => {
  it("computes medians", () => {
    expect(median([0.1, 0.3, 0.2])).toBeCloseTo(0.2);
    expect(median([0.1, null, 0.3, 0.2, 0.4])).toBeCloseTo(0.25);
  });

  it("computes CAGR", () => {
    expect(cagr(100, 161.051, 5)).toBeCloseTo(0.1, 4);
  });

  it("maps sector discount rates", () => {
    expect(defaultDiscountRate("Utilities")).toBe(0.07);
    expect(defaultDiscountRate("Information Technology")).toBe(0.105);
    expect(defaultDiscountRate(null)).toBe(0.1);
  });

  it("labels priced-in growth factually", () => {
    expect(deriveSignal(0.15, 0.1)).toBe("priced-in growth looks high vs history");
    expect(deriveSignal(0.05, 0.1)).toBe("priced-in growth looks low vs history");
    expect(deriveSignal(0.11, 0.1)).toBe("priced-in growth is near history");
  });

  it("solves reverse DCF growth", () => {
    const output = buildModel({
      enterpriseValue: 1800,
      baseRevenue: 100,
      normalizedFcfMargin: 0.25,
      discountRate: 0.1,
      terminalGrowth: 0.03,
      historicalRevenueCagr5y: 0.08
    });

    expect(output.status).toBe("ok");
    expect(output.impliedRevenueCagr).toBeGreaterThan(0);
    expect(output.gridRows.length).toBeGreaterThan(10);
  });

  it("returns an invalid status when terminal growth exceeds discount rate", () => {
    const output = buildModel({
      enterpriseValue: 1000,
      baseRevenue: 100,
      normalizedFcfMargin: 0.2,
      discountRate: 0.03,
      terminalGrowth: 0.04,
      historicalRevenueCagr5y: 0.08
    });

    expect(output.status).toBe("invalid-assumptions");
  });

  it("reports an above-range boundary when even +100% growth is too low", () => {
    const output = buildModel({
      enterpriseValue: 1_000_000_000,
      baseRevenue: 100,
      normalizedFcfMargin: 0.1,
      discountRate: 0.1,
      terminalGrowth: 0.03,
      historicalRevenueCagr5y: 0.08
    });
    expect(output.status).toBe("above-range");
    expect(output.diagnostics?.boundaryDirection).toBe("requires-higher-growth");
    expect(output.statusMessage).toMatch(/\+100%/);
  });

  it("reports a below-range boundary when even -50% growth is too high", () => {
    const output = buildModel({
      enterpriseValue: 1,
      baseRevenue: 100,
      normalizedFcfMargin: 0.2,
      discountRate: 0.1,
      terminalGrowth: 0.03,
      historicalRevenueCagr5y: 0.08
    });
    expect(output.status).toBe("below-range");
    expect(output.diagnostics?.boundaryDirection).toBe("requires-lower-growth");
    expect(output.statusMessage).toMatch(/-50%/);
  });

  it("applies an FCF exit multiple as terminal value (Y5 FCF x multiple)", () => {
    const output = buildModel({
      enterpriseValue: 1800,
      baseRevenue: 100,
      normalizedFcfMargin: 0.25,
      discountRate: 0.1,
      terminalGrowth: 0.03,
      historicalRevenueCagr5y: 0.08,
      terminalMethod: "exit-multiple",
      exitMetric: "fcf",
      exitMultiple: 20
    });
    expect(output.status).toBe("ok");
    const y5Fcf = output.gridRows.find((r) => r.label === "Free cash flow")?.values[5] as number;
    const terminalValue = output.gridRows.find((r) => r.label === "Terminal value")?.values[5] as number;
    expect(terminalValue).toBeCloseTo(y5Fcf * 20, 2);
  });

  it("applies a revenue exit multiple as terminal value (Y5 revenue x multiple)", () => {
    const output = buildModel({
      enterpriseValue: 1800,
      baseRevenue: 100,
      normalizedFcfMargin: 0.25,
      discountRate: 0.1,
      terminalGrowth: 0.03,
      historicalRevenueCagr5y: 0.08,
      terminalMethod: "exit-multiple",
      exitMetric: "revenue",
      exitMultiple: 5
    });
    expect(output.status).toBe("ok");
    const y5Rev = output.gridRows.find((r) => r.label === "Revenue")?.values[5] as number;
    const terminalValue = output.gridRows.find((r) => r.label === "Terminal value")?.values[5] as number;
    expect(terminalValue).toBeCloseTo(y5Rev * 5, 2);
  });

  it("applies an EBITDA exit multiple as terminal value (Y5 revenue x EBITDA margin x multiple)", () => {
    const output = buildModel({
      enterpriseValue: 1800,
      baseRevenue: 100,
      normalizedFcfMargin: 0.25,
      discountRate: 0.1,
      terminalGrowth: 0.03,
      historicalRevenueCagr5y: 0.08,
      terminalMethod: "exit-multiple",
      exitMetric: "ebitda",
      exitMultiple: 12,
      normalizedEbitdaMargin: 0.3
    });
    expect(output.status).toBe("ok");
    const y5Rev = output.gridRows.find((r) => r.label === "Revenue")?.values[5] as number;
    const terminalValue = output.gridRows.find((r) => r.label === "Terminal value")?.values[5] as number;
    expect(terminalValue).toBeCloseTo(y5Rev * 0.3 * 12, 2);
  });

  it("solves an exit-multiple model even when discount rate <= terminal growth", () => {
    const output = buildModel({
      enterpriseValue: 1800,
      baseRevenue: 100,
      normalizedFcfMargin: 0.25,
      discountRate: 0.03,
      terminalGrowth: 0.04,
      historicalRevenueCagr5y: 0.08,
      terminalMethod: "exit-multiple",
      exitMetric: "fcf",
      exitMultiple: 20
    });
    expect(output.status).toBe("ok");
  });

  it("requires a positive EBITDA margin for an EBITDA exit multiple", () => {
    const output = buildModel({
      enterpriseValue: 1800,
      baseRevenue: 100,
      normalizedFcfMargin: 0.25,
      discountRate: 0.1,
      terminalGrowth: 0.03,
      historicalRevenueCagr5y: 0.08,
      terminalMethod: "exit-multiple",
      exitMetric: "ebitda",
      exitMultiple: 12,
      normalizedEbitdaMargin: null
    });
    expect(output.status).toBe("insufficient-data");
  });

  it("builds two perpetuity sensitivity tables whose center cell matches the base solve", () => {
    const inputs = {
      enterpriseValue: 1800,
      baseRevenue: 100,
      normalizedFcfMargin: 0.25,
      discountRate: 0.1,
      terminalGrowth: 0.03,
      historicalRevenueCagr5y: 0.08
    } as const;
    const tables = buildSensitivity(inputs);
    expect(tables).toHaveLength(2);
    expect(tables[0].rowLabel).toBe("FCF margin");
    expect(tables[0].colLabel).toBe("Discount rate");
    expect(tables[1].colLabel).toBe("Terminal growth");
    // center of margin axis (index 2) and discount axis (delta 0 at index 2) equals the base implied CAGR
    const base = buildModel(inputs).impliedRevenueCagr as number;
    expect(tables[0].cells[2][2]).toBeCloseTo(base, 4);
  });

  it("switches the second sensitivity table to exit multiple in exit-multiple mode", () => {
    const tables = buildSensitivity({
      enterpriseValue: 1800,
      baseRevenue: 100,
      normalizedFcfMargin: 0.25,
      discountRate: 0.1,
      terminalGrowth: 0.03,
      historicalRevenueCagr5y: 0.08,
      terminalMethod: "exit-multiple",
      exitMetric: "fcf",
      exitMultiple: 20
    });
    expect(tables).toHaveLength(2);
    expect(tables[1].colLabel).toBe("Exit multiple");
    expect(tables[1].colFormat).toBe("multiple");
  });

  it("returns no sensitivity tables when base assumptions are missing", () => {
    expect(buildSensitivity({
      enterpriseValue: 1800,
      baseRevenue: 100,
      normalizedFcfMargin: null,
      discountRate: 0.1,
      terminalGrowth: 0.03,
      historicalRevenueCagr5y: 0.08
    })).toHaveLength(0);
  });
});
