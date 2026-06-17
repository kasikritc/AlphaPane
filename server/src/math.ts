import type { ModelCell, Signal } from "@alphapane/shared";

export interface HistoryPoint {
  year: number;
  value: number;
  reportDate: string;
}

export interface FcfPoint extends HistoryPoint {
  margin: number | null;
}

export interface DcfInputs {
  enterpriseValue: number | null;
  baseRevenue: number | null;
  normalizedFcfMargin: number | null;
  discountRate: number | null;
  terminalGrowth: number | null;
  historicalRevenueCagr5y: number | null;
}

export interface ModelOutput {
  impliedRevenueCagr: number | null;
  cagrGap: number | null;
  signal: Signal;
  status: string;
  statusMessage: string | null;
  gridRows: ModelCell[];
}

export function median(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => Number.isFinite(value));
  if (clean.length === 0) return null;
  clean.sort((a, b) => a - b);
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

export function cagr(start: number | null, end: number | null, years: number): number | null {
  if (!start || !end || start <= 0 || end <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

export function defaultDiscountRate(sector: string | null): number {
  switch (sector) {
    case "Utilities":
      return 0.07;
    case "Real Estate":
      return 0.085;
    case "Consumer Staples":
      return 0.08;
    case "Health Care":
    case "Industrials":
      return 0.09;
    case "Financials":
    case "Energy":
    case "Consumer Discretionary":
    case "Communication Services":
      return 0.1;
    case "Information Technology":
      return 0.105;
    default:
      return 0.1;
  }
}

export function normalizeTerminalGrowth(historicalRevenueCagr5y: number | null): number | null {
  if (!Number.isFinite(historicalRevenueCagr5y)) return null;
  return Math.min(historicalRevenueCagr5y as number, 0.03);
}

export function deriveSignal(implied: number | null, historical: number | null): Signal {
  if (!Number.isFinite(implied) || !Number.isFinite(historical)) return "insufficient data";
  const gap = (implied as number) - (historical as number);
  if (gap > 0.03) return "priced-in growth looks high vs history";
  if (gap < -0.03) return "priced-in growth looks low vs history";
  return "priced-in growth is near history";
}

export function buildModel(inputs: DcfInputs): ModelOutput {
  const missing = requiredMissing(inputs);
  if (missing.length > 0) {
    return {
      impliedRevenueCagr: null,
      cagrGap: null,
      signal: "insufficient data",
      status: "insufficient-data",
      statusMessage: `Missing ${missing.join(", ")}.`,
      gridRows: emptyGrid()
    };
  }

  const enterpriseValue = inputs.enterpriseValue as number;
  const baseRevenue = inputs.baseRevenue as number;
  const normalizedFcfMargin = inputs.normalizedFcfMargin as number;
  const discountRate = inputs.discountRate as number;
  const terminalGrowth = inputs.terminalGrowth as number;

  if (normalizedFcfMargin <= 0) {
    return invalid("Normalized FCF margin must be positive for this reverse DCF.");
  }
  if (discountRate <= terminalGrowth) {
    return invalid("Discount rate must be greater than terminal growth.");
  }

  const impliedRevenueCagr = solveGrowth((growth) =>
    intrinsicDcfEv({
      baseRevenue,
      growth,
      normalizedFcfMargin,
      discountRate,
      terminalGrowth
    }) - enterpriseValue
  );

  const cagrGap =
    Number.isFinite(impliedRevenueCagr) && Number.isFinite(inputs.historicalRevenueCagr5y)
      ? (impliedRevenueCagr as number) - (inputs.historicalRevenueCagr5y as number)
      : null;
  const signal = deriveSignal(impliedRevenueCagr, inputs.historicalRevenueCagr5y);
  const gridRows = makeGridRows({
    enterpriseValue,
    baseRevenue,
    normalizedFcfMargin,
    discountRate,
    terminalGrowth,
    impliedRevenueCagr
  });

  return {
    impliedRevenueCagr,
    cagrGap,
    signal,
    status: impliedRevenueCagr === null ? "outside-model-range" : "ok",
    statusMessage: impliedRevenueCagr === null ? "Reverse DCF solve is outside the -50% to +100% model range." : null,
    gridRows
  };
}

function requiredMissing(inputs: DcfInputs): string[] {
  const checks: Array<[keyof DcfInputs, string]> = [
    ["enterpriseValue", "enterprise value"],
    ["baseRevenue", "base revenue"],
    ["normalizedFcfMargin", "normalized FCF margin"],
    ["discountRate", "discount rate"],
    ["terminalGrowth", "terminal growth"]
  ];
  return checks
    .filter(([key]) => !Number.isFinite(inputs[key]))
    .map(([, label]) => label);
}

function invalid(message: string): ModelOutput {
  return {
    impliedRevenueCagr: null,
    cagrGap: null,
    signal: "insufficient data",
    status: "invalid-assumptions",
    statusMessage: message,
    gridRows: emptyGrid()
  };
}

function emptyGrid(): ModelCell[] {
  return [
    { label: "Revenue", kind: "blank", values: [], format: "currency" },
    { label: "Free cash flow", kind: "blank", values: [], format: "currency" },
    { label: "Implied 5Y revenue CAGR", kind: "blank", values: [], format: "percent" }
  ];
}

function solveGrowth(fn: (growth: number) => number): number | null {
  let low = -0.5;
  let high = 1.0;
  let lowValue = fn(low);
  let highValue = fn(high);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue)) return null;
  if (lowValue === 0) return low;
  if (highValue === 0) return high;
  if (lowValue > 0 || highValue < 0) return null;

  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    const value = fn(mid);
    if (Math.abs(value) < 1) return mid;
    if (value < 0) {
      low = mid;
      lowValue = value;
    } else {
      high = mid;
      highValue = value;
    }
  }
  return (low + high) / 2;
}

function intrinsicDcfEv(input: {
  baseRevenue: number;
  growth: number;
  normalizedFcfMargin: number;
  discountRate: number;
  terminalGrowth: number;
}): number {
  const cashFlows = forecastCashFlows(input.baseRevenue, input.growth, input.normalizedFcfMargin);
  const pvFcf = cashFlows.reduce((sum, fcf, index) => sum + fcf / Math.pow(1 + input.discountRate, index + 1), 0);
  const terminalFcf = cashFlows[4] * (1 + input.terminalGrowth);
  const terminalValue = terminalFcf / (input.discountRate - input.terminalGrowth);
  return pvFcf + terminalValue / Math.pow(1 + input.discountRate, 5);
}

function forecastRevenues(baseRevenue: number, growth: number): number[] {
  return Array.from({ length: 5 }, (_, index) => baseRevenue * Math.pow(1 + growth, index + 1));
}

function forecastCashFlows(baseRevenue: number, growth: number, margin: number): number[] {
  return forecastRevenues(baseRevenue, growth).map((revenue) => revenue * margin);
}

function makeGridRows(input: {
  enterpriseValue: number;
  baseRevenue: number;
  normalizedFcfMargin: number;
  discountRate: number;
  terminalGrowth: number;
  impliedRevenueCagr: number | null;
}): ModelCell[] {
  const growth = input.impliedRevenueCagr ?? 0;
  const revenues = forecastRevenues(input.baseRevenue, growth);
  const fcf = revenues.map((revenue) => revenue * input.normalizedFcfMargin);
  const discountFactors = Array.from({ length: 5 }, (_, index) => 1 / Math.pow(1 + input.discountRate, index + 1));
  const pvFcf = fcf.map((value, index) => value * discountFactors[index]);
  const terminalValue =
    input.discountRate > input.terminalGrowth
      ? (fcf[4] * (1 + input.terminalGrowth)) / (input.discountRate - input.terminalGrowth)
      : null;
  const pvTerminalValue = terminalValue === null ? null : terminalValue * discountFactors[4];
  const intrinsicEv = pvFcf.reduce((sum, value) => sum + value, 0) + (pvTerminalValue ?? 0);

  return [
    { label: "Revenue", kind: "calculated", values: [input.baseRevenue, ...revenues, null], format: "currency" },
    { label: "Revenue growth", kind: "solved", values: [null, ...Array(5).fill(input.impliedRevenueCagr), null], format: "percent" },
    { label: "Normalized FCF margin", kind: "assumption", values: [null, ...Array(5).fill(input.normalizedFcfMargin), null], format: "percent" },
    { label: "Free cash flow", kind: "calculated", values: [null, ...fcf, null], format: "currency" },
    { label: "Discount rate", kind: "assumption", values: [null, ...Array(5).fill(input.discountRate), null], format: "percent" },
    { label: "Discount factor", kind: "calculated", values: [null, ...discountFactors, null], format: "number" },
    { label: "PV of FCF", kind: "calculated", values: [null, ...pvFcf, null], format: "currency" },
    { label: "Terminal growth", kind: "assumption", values: [null, null, null, null, null, input.terminalGrowth, null], format: "percent" },
    { label: "Terminal value", kind: "calculated", values: [null, null, null, null, null, terminalValue, null], format: "currency" },
    { label: "PV terminal value", kind: "calculated", values: [null, null, null, null, null, pvTerminalValue, null], format: "currency" },
    { label: "Intrinsic EV", kind: "calculated", values: [null, null, null, null, null, null, intrinsicEv], format: "currency" },
    { label: "Current EV", kind: "actual", values: [null, null, null, null, null, null, input.enterpriseValue], format: "currency" },
    { label: "Implied 5Y revenue CAGR", kind: "solved", values: [null, null, null, null, null, null, input.impliedRevenueCagr], format: "percent" }
  ];
}
