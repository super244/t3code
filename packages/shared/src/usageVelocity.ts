/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=60m; seat=codex; date=2026-10-15 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=5m; seat=antigravity; date=2026-10-02 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=20m; seat=codex; date=2026-10-02 */
import {
  USAGE_CONTRACT_VERSION,
  type UsageProviderKind,
  type UsageSummary,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const DAY_MS = 86_400_000;

export interface UsageVelocityMetrics {
  readonly daysCount: number;
  readonly dailyCostVelocity: number;
  readonly thirtyDayCostUsd: number;
  readonly dailyTokenVelocity: number;
}

function calendarTime(day: string): number {
  const time = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(time) && DateTime.formatIso(DateTime.makeUnsafe(time)).slice(0, 10) === day
    ? time
    : Number.NaN;
}

/** Average recorded usage over the query bounds, including quiet periods. */
export function calculateUsageVelocity(params: {
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly window: UsageSummaryInput;
  readonly allHistory: boolean;
  readonly observedDays: readonly string[];
}): UsageVelocityMetrics | null {
  const { window } = params;
  let days: number;
  if (window.resolution === "hour") {
    // Hour buckets straddle rolling bounds; their count is not the duration.
    const start = Date.parse(window.sinceTime ?? "");
    const end = Date.parse(window.untilTime ?? "");
    days = (end - start) / DAY_MS;
  } else {
    let start = calendarTime(window.sinceDay);
    let end = calendarTime(window.untilDay);
    if (params.allHistory) {
      if (params.observedDays.length === 0) return null;
      start = Infinity;
      end = -Infinity;
      for (const day of params.observedDays) {
        const time = calendarTime(day);
        if (!Number.isFinite(time)) return null;
        start = Math.min(start, time);
        end = Math.max(end, time);
      }
    }
    // Calendar-day queries include both endpoints, independent of DST.
    days = (end - start) / DAY_MS + 1;
  }
  if (
    !Number.isFinite(days) ||
    days <= 0 ||
    !Number.isFinite(params.costUsd) ||
    params.costUsd < 0 ||
    !Number.isFinite(params.totalTokens) ||
    params.totalTokens < 0
  )
    return null;

  const dailyCostVelocity = params.costUsd / days;
  const dailyTokenVelocity = params.totalTokens / days;
  const thirtyDayCostUsd = dailyCostVelocity * 30;
  if (
    !Number.isFinite(dailyCostVelocity) ||
    !Number.isFinite(dailyTokenVelocity) ||
    !Number.isFinite(thirtyDayCostUsd)
  )
    return null;
  return {
    daysCount: days,
    dailyCostVelocity,
    thirtyDayCostUsd,
    dailyTokenVelocity,
  };
}

export type UsageComparisonCoverage = "complete" | "unpriced" | "partial";
export type BudgetStatus = "on_track" | "warning" | "exceeded" | "unknown";

const minimumContract: Record<UsageProviderKind, number> = {
  codex: 7,
  claude: 7,
  grok: 7,
  opencode: 7,
  antigravity: 7,
};

/** A below-target indicator requires both priced records and complete selected sources. */
export function usageComparisonCoverage(input: {
  readonly unpricedShare: number;
  readonly staleEnvironmentCount: number;
  readonly provider: UsageProviderKind | null;
  readonly environments: readonly {
    readonly summary: UsageSummary | null;
    readonly error: unknown;
    readonly isPending: boolean;
  }[];
}): UsageComparisonCoverage {
  if (
    input.environments.length === 0 ||
    input.staleEnvironmentCount > 0 ||
    input.environments.some(
      (environment) =>
        environment.isPending ||
        environment.error != null ||
        environment.summary === null ||
        environment.summary.contractVersion <
          (input.provider === null ? USAGE_CONTRACT_VERSION : minimumContract[input.provider]) ||
        environment.summary.sources.some(
          (source) =>
            (input.provider === null || source.fingerprint.provider === input.provider) &&
            (source.status === "partial" || source.status === "failed"),
        ),
    )
  )
    return "partial";
  return input.unpricedShare > 0 ? "unpriced" : "complete";
}

export interface BudgetAssessment {
  /** Existing preference key; the target compares API-equivalent cost over 30 days. */
  readonly monthlyBudgetUsd: number;
  readonly thirtyDayCostUsd: number;
  readonly percentOfBudget: number;
  readonly status: BudgetStatus;
  readonly label: string;
}

export function assessSpendBudget(params: {
  readonly monthlyBudgetUsd: number | null | undefined;
  readonly thirtyDayCostUsd: number | null | undefined;
  readonly comparisonCoverage: UsageComparisonCoverage;
}): BudgetAssessment | null {
  if (
    params.monthlyBudgetUsd === null ||
    params.monthlyBudgetUsd === undefined ||
    !Number.isFinite(params.monthlyBudgetUsd) ||
    params.monthlyBudgetUsd <= 0 ||
    params.thirtyDayCostUsd === null ||
    params.thirtyDayCostUsd === undefined ||
    !Number.isFinite(params.thirtyDayCostUsd) ||
    params.thirtyDayCostUsd < 0
  ) {
    return null;
  }

  const ratio = params.thirtyDayCostUsd / params.monthlyBudgetUsd;
  if (!Number.isFinite(ratio * 100)) return null;
  // Keep a rounded, below-threshold value visibly below its boundary.
  const roundedPercent = Number((ratio * 100).toFixed(1));
  const percentOfBudget =
    ratio < 0.8 && roundedPercent >= 80
      ? 79.9
      : ratio < 1 && roundedPercent >= 100
        ? 99.9
        : roundedPercent;
  let status: BudgetStatus = "on_track";
  let label = "Below the comparison target";
  if (params.comparisonCoverage !== "complete") {
    status = "unknown";
    label =
      params.comparisonCoverage === "unpriced"
        ? "Some usage has no price"
        : "Selected history is incomplete";
  } else if (ratio >= 1) {
    status = "exceeded";
    label = "At or above the comparison target";
  } else if (ratio >= 0.8) {
    status = "warning";
    label = "Nearing the comparison target";
  }

  return {
    monthlyBudgetUsd: params.monthlyBudgetUsd,
    thirtyDayCostUsd: params.thirtyDayCostUsd,
    percentOfBudget,
    status,
    label,
  };
}
