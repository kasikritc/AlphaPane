export interface StockPricePoint extends Record<string, unknown> {
  date: string;
  open_price?: number;
  close_price?: number;
  price?: number;
  volume?: number;
}

export function stockClosePrice(point: Partial<StockPricePoint>): number | null {
  const value = point.close_price ?? point.price;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
