import { describe, expect, it } from "vitest";
import { buildModel, cagr, defaultDiscountRate, deriveSignal, median } from "./math.js";

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
});
