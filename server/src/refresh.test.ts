import { describe, expect, it } from "vitest";
import { buildFinancialBases } from "./refresh.js";

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
