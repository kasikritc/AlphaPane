import type { ExitMetric, TerminalMethod } from "./index.js";

export interface DcfSolveInputs {
  enterpriseValue: number | null;
  baseRevenue: number | null;
  normalizedFcfMargin: number | null;
  discountRate: number | null;
  terminalGrowth: number | null;
  terminalMethod?: TerminalMethod | null;
  exitMetric?: ExitMetric | null;
  exitMultiple?: number | null;
  normalizedEbitdaMargin?: number | null;
}

function isFinitePositive(value: number | null | undefined): value is number {
  return Number.isFinite(value) && (value as number) > 0;
}

export function solveImpliedGrowth(inputs: DcfSolveInputs): number | null {
  const enterpriseValue = inputs.enterpriseValue;
  const baseRevenue = inputs.baseRevenue;
  const normalizedFcfMargin = inputs.normalizedFcfMargin;
  const discountRate = inputs.discountRate;
  const terminalMethod: TerminalMethod = inputs.terminalMethod ?? "perpetuity";
  const exitMetric: ExitMetric = inputs.exitMetric ?? "fcf";
  const terminalGrowth = inputs.terminalGrowth ?? 0;
  const exitMultiple = inputs.exitMultiple ?? 0;
  const normalizedEbitdaMargin = inputs.normalizedEbitdaMargin ?? null;

  if (
    !isFinitePositive(enterpriseValue) ||
    !isFinitePositive(baseRevenue) ||
    !isFinitePositive(normalizedFcfMargin) ||
    !isFinitePositive(discountRate)
  ) {
    return null;
  }

  if (terminalMethod === "perpetuity") {
    if (discountRate <= terminalGrowth) return null;
  } else {
    if (!isFinitePositive(exitMultiple)) return null;
    if (exitMetric === "ebitda" && !(normalizedEbitdaMargin !== null && normalizedEbitdaMargin > 0)) return null;
  }

  return solveGrowth(
    (growth) => evaluateDcf({ baseRevenue: baseRevenue as number, growth, normalizedFcfMargin: normalizedFcfMargin as number, discountRate: discountRate as number, terminal: { terminalMethod, terminalGrowth, exitMetric, exitMultiple, normalizedEbitdaMargin } }),
    enterpriseValue as number
  );
}

export function evaluateDcf(input: {
  baseRevenue: number;
  growth: number;
  normalizedFcfMargin: number;
  discountRate: number;
  terminal: {
    terminalMethod: TerminalMethod;
    terminalGrowth: number;
    exitMetric: ExitMetric;
    exitMultiple: number;
    normalizedEbitdaMargin: number | null;
  };
}): number {
  const revenues = Array.from({ length: 5 }, (_, index) => input.baseRevenue * Math.pow(1 + input.growth, index + 1));
  const fcf = revenues.map((revenue) => revenue * input.normalizedFcfMargin);
  const pvFcf = fcf.reduce((sum, value, index) => sum + value / Math.pow(1 + input.discountRate, index + 1), 0);

  let terminalValue: number;
  if (input.terminal.terminalMethod === "exit-multiple") {
    terminalValue = terminalMetricValue(input.terminal.exitMetric, revenues[4], fcf[4], input.terminal.normalizedEbitdaMargin) * input.terminal.exitMultiple;
  } else {
    terminalValue = (fcf[4] * (1 + input.terminal.terminalGrowth)) / (input.discountRate - input.terminal.terminalGrowth);
  }
  const pvTerminalValue = terminalValue / Math.pow(1 + input.discountRate, 5);
  return pvFcf + pvTerminalValue;
}

export function terminalMetricValue(metric: ExitMetric, revenueY5: number, fcfY5: number, ebitdaMargin: number | null): number {
  switch (metric) {
    case "revenue":
      return revenueY5;
    case "ebitda":
      return revenueY5 * (ebitdaMargin ?? 0);
    case "fcf":
    default:
      return fcfY5;
  }
}

function solveGrowth(modeledEv: (growth: number) => number, targetEv: number): number | null {
  let low = -0.5;
  let high = 1.0;
  const lowModeledEv = modeledEv(low);
  const highModeledEv = modeledEv(high);
  const lowDelta = lowModeledEv - targetEv;
  const highDelta = highModeledEv - targetEv;

  if (!Number.isFinite(lowDelta) || !Number.isFinite(highDelta)) return null;
  if (lowDelta === 0) return low;
  if (highDelta === 0) return high;
  if (lowDelta > 0 || highDelta < 0) return null;

  let lowBound = low;
  let highBound = high;
  for (let i = 0; i < 100; i += 1) {
    const mid = (lowBound + highBound) / 2;
    const value = modeledEv(mid) - targetEv;
    if (Math.abs(value) < 1) return mid;
    if (value < 0) lowBound = mid;
    else highBound = mid;
  }
  return (lowBound + highBound) / 2;
}

export interface RevenuePoint {
  reportDate: string;
  revenue: number;
}

export interface RealizedGrowthPoint {
  date: string;
  realizedCagr: number | null;
  isPartial: boolean;
}

export function cagr(start: number, end: number, years: number): number | null {
  if (start <= 0 || end <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

export function computeRealizedGrowth(revenueTimeline: RevenuePoint[]): RealizedGrowthPoint[] {
  const sorted = [...revenueTimeline]
    .filter((point) => Number.isFinite(point.revenue) && point.revenue > 0)
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  return sorted.map((point, index) => {
    const futureIndex = index + 5;
    if (futureIndex < sorted.length) {
      const futureRevenue = sorted[futureIndex].revenue;
      const realized = cagr(point.revenue, futureRevenue, 5);
      return { date: point.reportDate, realizedCagr: realized, isPartial: false };
    }
    const lastIndex = sorted.length - 1;
    if (lastIndex > index) {
      const futureRevenue = sorted[lastIndex].revenue;
      const yearsElapsed = lastIndex - index;
      if (yearsElapsed < 1) return { date: point.reportDate, realizedCagr: null, isPartial: true };
      const realized = cagr(point.revenue, futureRevenue, yearsElapsed);
      return { date: point.reportDate, realizedCagr: realized, isPartial: true };
    }
    return { date: point.reportDate, realizedCagr: null, isPartial: true };
  });
}
