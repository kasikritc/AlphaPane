import { describe, expect, it } from "vitest";
import { buildValuationSnapshot, computeMetricStats, MIN_VALUATION_OBSERVATIONS } from "./valuation.js";

function points(values: number[]) {
  return values.map((ratio, index) => ({
    date: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10),
    ratio
  }));
}

describe("valuation stats", () => {
  it("scores low P/E values as negative z-scores", () => {
    const stats = computeMetricStats(
      { key: "pe", label: "P/E", ratioId: "ratio_price_to_earnings", lowerIsCheaper: true },
      points([...Array(MIN_VALUATION_OBSERVATIONS).fill(20), 10])
    );

    expect(stats.status).toBe("ok");
    expect(stats.zScore).toBeLessThan(0);
    expect(stats.percentileRank).toBeLessThan(0.1);
  });

  it("pushes invalid and insufficient P/E data to insufficient data", () => {
    const stats = computeMetricStats(
      { key: "pe", label: "P/E", ratioId: "ratio_price_to_earnings", lowerIsCheaper: true },
      points([20, 18, -5, 0, 22])
    );

    expect(stats.status).toBe("insufficient data");
    expect(stats.current).toBeNull();
    expect(stats.zScore).toBeNull();
  });

  it("treats high FCF yield as cheaper", () => {
    const stats = computeMetricStats(
      { key: "fcfYield", label: "FCF Yield", ratioId: "ratio_fcf_yield", lowerIsCheaper: false },
      points([...Array(MIN_VALUATION_OBSERVATIONS).fill(0.04), 0.08])
    );

    expect(stats.status).toBe("ok");
    expect(stats.zScore).toBeLessThan(0);
    expect(stats.percentileRank).toBeLessThan(0.1);
  });

  it("builds P/E band history from Fiscal stock price rows with a price field", () => {
    const pePoints = points([...Array(MIN_VALUATION_OBSERVATIONS).fill(20), 10]);
    const pricePoints = pePoints.map((point) => ({ date: point.date, price: 100 }));

    const snapshot = buildValuationSnapshot({
      pe: pePoints,
      evSales: [],
      evEbitda: [],
      priceSales: [],
      fcfYield: []
    }, pricePoints);

    expect(snapshot.metrics.pe.status).toBe("ok");
    expect(snapshot.peHistory).toHaveLength(pePoints.length);
    expect(snapshot.peHistory.every((point) => point.price === 100)).toBe(true);
    expect(snapshot.peHistory.at(-1)?.bandPrices.Mean).toBeGreaterThan(0);
  });
});
