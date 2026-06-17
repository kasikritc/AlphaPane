import { describe, expect, it } from "vitest";
import { buildEvBridge, buildFinancialBases } from "./refresh.js";

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
