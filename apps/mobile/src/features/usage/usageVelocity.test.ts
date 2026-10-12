/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=20m; seat=codex; date=2026-10-02 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=5m; seat=antigravity; date=2026-10-02 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
import { UsageDay, type UsageSummaryInput } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { assessSpendBudget, calculateUsageVelocity } from "./usageVelocity";

const window: UsageSummaryInput = {
  sinceDay: UsageDay.make("2026-10-01"),
  untilDay: UsageDay.make("2026-10-05"),
  timeZone: "America/Vancouver",
};
const input = { costUsd: 10, totalTokens: 100_000, window, allHistory: false, observedDays: [] };

describe("recorded usage rates", () => {
  it("averages all calendar days, including days without records", () => {
    expect(
      calculateUsageVelocity({ ...input, observedDays: ["2026-10-01", "2026-10-05"] }),
    ).toEqual({
      daysCount: 5,
      dailyCostVelocity: 2,
      thirtyDayCostUsd: 60,
      dailyTokenVelocity: 20_000,
    });
  });

  it("uses exact rolling bounds for a five-hour window straddling six hour buckets", () => {
    const result = calculateUsageVelocity({
      ...input,
      costUsd: 5,
      window: {
        ...window,
        resolution: "hour",
        sinceTime: "2026-10-01T10:37:00Z",
        untilTime: "2026-10-01T15:37:00Z",
      },
    });
    expect(result?.daysCount).toBeCloseTo(5 / 24);
    expect(result?.dailyCostVelocity).toBe(24);
    expect(result?.thirtyDayCostUsd).toBe(720);
  });

  it("normalizes a one-hour window to a daily rate instead of clamping to one day", () => {
    const result = calculateUsageVelocity({
      ...input,
      costUsd: 1,
      totalTokens: 100,
      window: {
        ...window,
        resolution: "hour",
        sinceTime: "2026-10-01T10:37:00Z",
        untilTime: "2026-10-01T11:37:00Z",
      },
    });
    expect(result?.dailyCostVelocity).toBe(24);
    expect(result?.dailyTokenVelocity).toBe(2_400);
  });

  it("uses the complete recorded span for All regardless of gaps or sort order", () => {
    expect(
      calculateUsageVelocity({
        ...input,
        allHistory: true,
        observedDays: ["2026-10-05", "2026-10-01"],
      }),
    ).toEqual({
      daysCount: 5,
      dailyCostVelocity: 2,
      thirtyDayCostUsd: 60,
      dailyTokenVelocity: 20_000,
    });
  });

  it("counts calendar days across DST rather than elapsed 24-hour periods", () => {
    const result = calculateUsageVelocity({
      ...input,
      costUsd: 6,
      window: {
        ...window,
        sinceDay: UsageDay.make("2026-11-01"),
        untilDay: UsageDay.make("2026-11-02"),
      },
    });
    expect(result?.daysCount).toBe(2);
    expect(result?.dailyCostVelocity).toBe(3);
  });

  it("does not invent a duration for empty All history or invalid/reversed bounds", () => {
    expect(calculateUsageVelocity({ ...input, allHistory: true })).toBeNull();
    expect(
      calculateUsageVelocity({
        ...input,
        window: { ...window, sinceDay: UsageDay.make("2026-10-07") },
      }),
    ).toBeNull();
    expect(
      calculateUsageVelocity({
        ...input,
        window: { ...window, sinceDay: UsageDay.make("2026-02-30") },
      }),
    ).toBeNull();
    expect(
      calculateUsageVelocity({ ...input, window: { ...window, resolution: "hour" } }),
    ).toBeNull();
    expect(
      calculateUsageVelocity({
        ...input,
        window: {
          ...window,
          resolution: "hour",
          sinceTime: "2026-10-01T12:00:00Z",
          untilTime: "2026-10-01T12:00:00Z",
        },
      }),
    ).toBeNull();
  });

  it("distinguishes a known zero-usage window from unavailable history", () => {
    expect(
      calculateUsageVelocity({ ...input, costUsd: 0, totalTokens: 0 })?.dailyCostVelocity,
    ).toBe(0);
    expect(calculateUsageVelocity({ ...input, costUsd: Number.NaN })).toBeNull();
    expect(calculateUsageVelocity({ ...input, costUsd: Number.MAX_VALUE })).toBeNull();
  });
});

describe("assessSpendBudget", () => {
  it("checks target thresholds before rounding the displayed percentage", () => {
    expect(
      assessSpendBudget({
        monthlyBudgetUsd: 100,
        thirtyDayCostUsd: 79.6,
        comparisonCoverage: "complete",
      }),
    ).toMatchObject({ status: "on_track", percentOfBudget: 79.6 });
    expect(
      assessSpendBudget({
        monthlyBudgetUsd: 100,
        thirtyDayCostUsd: 99.6,
        comparisonCoverage: "complete",
      }),
    ).toMatchObject({ status: "warning", percentOfBudget: 99.6 });
    expect(
      assessSpendBudget({
        monthlyBudgetUsd: 100,
        thirtyDayCostUsd: 100,
        comparisonCoverage: "complete",
      }),
    ).toMatchObject({ status: "exceeded", percentOfBudget: 100 });
    expect(
      assessSpendBudget({
        monthlyBudgetUsd: 100,
        thirtyDayCostUsd: 79.96,
        comparisonCoverage: "complete",
      }),
    ).toMatchObject({ status: "on_track", percentOfBudget: 79.9 });
    expect(
      assessSpendBudget({
        monthlyBudgetUsd: 100,
        thirtyDayCostUsd: 99.96,
        comparisonCoverage: "complete",
      }),
    ).toMatchObject({ status: "warning", percentOfBudget: 99.9 });
  });

  it("does not claim a target is safe when pricing or history is incomplete", () => {
    for (const comparisonCoverage of ["unpriced", "partial"] as const) {
      expect(
        assessSpendBudget({ monthlyBudgetUsd: 100, thirtyDayCostUsd: 0, comparisonCoverage }),
      ).toMatchObject({ status: "unknown" });
    }
  });

  it("rejects a ratio that overflows despite finite individual inputs", () => {
    expect(
      assessSpendBudget({
        monthlyBudgetUsd: Number.MIN_VALUE,
        thirtyDayCostUsd: Number.MAX_VALUE,
        comparisonCoverage: "complete",
      }),
    ).toBeNull();
  });

  it("returns null when target or comparison cost is missing or invalid", () => {
    expect(
      assessSpendBudget({
        comparisonCoverage: "complete",
        monthlyBudgetUsd: null,
        thirtyDayCostUsd: 50,
      }),
    ).toBeNull();
    expect(
      assessSpendBudget({
        comparisonCoverage: "complete",
        monthlyBudgetUsd: 0,
        thirtyDayCostUsd: 50,
      }),
    ).toBeNull();
    expect(
      assessSpendBudget({
        comparisonCoverage: "complete",
        monthlyBudgetUsd: 100,
        thirtyDayCostUsd: null,
      }),
    ).toBeNull();
    expect(
      assessSpendBudget({
        comparisonCoverage: "complete",
        monthlyBudgetUsd: -10,
        thirtyDayCostUsd: 20,
      }),
    ).toBeNull();
  });

  it("evaluates on_track when spend is under 80% of budget", () => {
    const result = assessSpendBudget({
      comparisonCoverage: "complete",
      monthlyBudgetUsd: 100,
      thirtyDayCostUsd: 65,
    });
    expect(result).toEqual({
      monthlyBudgetUsd: 100,
      thirtyDayCostUsd: 65,
      percentOfBudget: 65,
      status: "on_track",
      label: "Below the comparison target",
    });
  });

  it("evaluates warning when spend is between 80% and 99% of budget", () => {
    const result = assessSpendBudget({
      comparisonCoverage: "complete",
      monthlyBudgetUsd: 50,
      thirtyDayCostUsd: 45,
    });
    expect(result).toEqual({
      monthlyBudgetUsd: 50,
      thirtyDayCostUsd: 45,
      percentOfBudget: 90,
      status: "warning",
      label: "Nearing the comparison target",
    });
  });

  it("evaluates exceeded when spend is 100% or more of budget", () => {
    const result = assessSpendBudget({
      comparisonCoverage: "complete",
      monthlyBudgetUsd: 100,
      thirtyDayCostUsd: 125,
    });
    expect(result).toEqual({
      monthlyBudgetUsd: 100,
      thirtyDayCostUsd: 125,
      percentOfBudget: 125,
      status: "exceeded",
      label: "At or above the comparison target",
    });
  });
});
