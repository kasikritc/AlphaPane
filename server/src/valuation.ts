import type { ValuationHistoryPoint, ValuationMetricKey, ValuationMetricStats } from "@alphapane/shared";
import type { StockPricePoint } from "./stockPrice.js";
import { stockClosePrice } from "./stockPrice.js";

export interface RatioConfig {
  key: ValuationMetricKey;
  label: string;
  ratioId: string;
  lowerIsCheaper: boolean;
}

export interface RatioPoint {
  date: string;
  ratio: number;
}

export type PricePoint = StockPricePoint;

export interface ValuationSnapshotInput {
  metrics: Record<ValuationMetricKey, ValuationMetricStats>;
  peHistory: ValuationHistoryPoint[];
  peBandLevels: Record<string, number | null>;
}

export const VALUATION_RATIOS: RatioConfig[] = [
  { key: "pe", label: "P/E", ratioId: "ratio_price_to_earnings", lowerIsCheaper: true },
  { key: "evSales", label: "EV/Sales", ratioId: "ratio_ev_to_sales", lowerIsCheaper: true },
  { key: "evEbitda", label: "EV/EBITDA", ratioId: "ratio_ev_to_ebitda", lowerIsCheaper: true },
  { key: "priceSales", label: "P/S", ratioId: "ratio_price_to_sales", lowerIsCheaper: true },
  { key: "fcfYield", label: "FCF Yield", ratioId: "ratio_fcf_yield", lowerIsCheaper: false }
];

export const MIN_VALUATION_OBSERVATIONS = 252;

export function buildValuationSnapshot(
  ratiosByKey: Record<ValuationMetricKey, RatioPoint[]>,
  prices: PricePoint[],
  years = 5
): ValuationSnapshotInput {
  const metrics = Object.fromEntries(
    VALUATION_RATIOS.map((config) => [config.key, computeMetricStats(config, ratiosByKey[config.key] ?? [], years)])
  ) as Record<ValuationMetricKey, ValuationMetricStats>;
  const peBandLevels = buildPeBandLevels(metrics.pe);
  return {
    metrics,
    peBandLevels,
    peHistory: buildPeHistory(ratiosByKey.pe ?? [], prices, peBandLevels, years)
  };
}

export function computeMetricStats(config: RatioConfig, points: RatioPoint[], years = 5): ValuationMetricStats {
  const window = windowedValidRatios(points, years).map((point) => point.ratio);
  const base = {
    key: config.key,
    label: config.label,
    ratioId: config.ratioId,
    current: null,
    mean: null,
    stdDev: null,
    zScore: null,
    percentileRank: null,
    observationCount: window.length,
    status: "insufficient data" as const
  };
  if (window.length < MIN_VALUATION_OBSERVATIONS) return base;
  const current = window.at(-1) ?? null;
  const meanValue = mean(window);
  const stdDev = standardDeviation(window, meanValue);
  if (!Number.isFinite(current) || !Number.isFinite(meanValue) || !isPositive(stdDev)) return base;
  const rawZ = ((current as number) - meanValue) / (stdDev as number);
  const zScore = config.lowerIsCheaper ? rawZ : -rawZ;
  const rawPercentile = percentileRank(window, current as number);
  const percentile = config.lowerIsCheaper ? rawPercentile : 1 - rawPercentile;
  return {
    ...base,
    current,
    mean: meanValue,
    stdDev,
    zScore,
    percentileRank: percentile,
    status: "ok"
  };
}

function buildPeBandLevels(pe: ValuationMetricStats): Record<string, number | null> {
  if (pe.status !== "ok" || !isPositive(pe.mean) || !isPositive(pe.stdDev)) {
    return { "-2σ": null, "-1σ": null, Mean: null, "+1σ": null, "+2σ": null };
  }
  const levels = {
    "-2σ": (pe.mean as number) - 2 * (pe.stdDev as number),
    "-1σ": (pe.mean as number) - (pe.stdDev as number),
    Mean: pe.mean as number,
    "+1σ": (pe.mean as number) + (pe.stdDev as number),
    "+2σ": (pe.mean as number) + 2 * (pe.stdDev as number)
  };
  return Object.fromEntries(Object.entries(levels).map(([key, value]) => [key, isPositive(value) ? value : null]));
}

function buildPeHistory(
  pePoints: RatioPoint[],
  prices: PricePoint[],
  bandLevels: Record<string, number | null>,
  years: number
): ValuationHistoryPoint[] {
  const pricesByDate = new Map(prices.map((price) => [price.date, stockClosePrice(price)]));
  return windowedValidRatios(pePoints, years).map((point) => {
    const price = pricesByDate.get(point.date) ?? null;
    const impliedEps = isPositive(price) && isPositive(point.ratio) ? (price as number) / point.ratio : null;
    return {
      date: point.date,
      price,
      pe: point.ratio,
      bandPrices: Object.fromEntries(
        Object.entries(bandLevels).map(([label, level]) => [label, isPositive(impliedEps) && isPositive(level) ? (impliedEps as number) * (level as number) : null])
      )
    };
  });
}

function windowedValidRatios(points: RatioPoint[], years: number): RatioPoint[] {
  const sorted = [...points]
    .map((point) => ({ date: String(point.date).slice(0, 10), ratio: numberOrNull(point.ratio) }))
    .filter((point): point is RatioPoint => Boolean(point.date) && isPositive(point.ratio))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1)?.date;
  if (!latest) return [];
  const cutoff = new Date(`${latest}T00:00:00.000Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  return sorted.filter((point) => point.date >= cutoffDate);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], meanValue: number): number | null {
  if (values.length < 2) return null;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - meanValue, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function percentileRank(values: number[], current: number): number {
  const below = values.filter((value) => value < current).length;
  const equal = values.filter((value) => value === current).length;
  return (below + 0.5 * equal) / values.length;
}

function isPositive(value: number | null | undefined): value is number {
  return Number.isFinite(value) && (value as number) > 0;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
