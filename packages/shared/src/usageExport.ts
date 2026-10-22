/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=60m; seat=codex; date=2026-10-15 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-01 */
import type { UsageProviderKind, UsageSummaryInput } from "@t3tools/contracts";
import type { MergedUsage } from "./usageMerge.ts";

export interface UsageReportInput {
  readonly merged: MergedUsage;
  readonly coverageIncomplete?: boolean;
  readonly window: UsageSummaryInput;
  readonly windowLabel: string;
  readonly metric: "cost" | "tokens";
  readonly exportedAt: string;
  readonly selectedProvider: UsageProviderKind | null;
  readonly selectedEnvironmentIds: readonly string[] | null;
  readonly providers: readonly { readonly provider: UsageProviderKind; readonly label: string }[];
}

/** Portable snapshot of the focused view. Maps never reach JSON.stringify. */
export function makeUsageReport(input: UsageReportInput) {
  const { merged } = input;
  const periods = input.window.resolution === "hour" ? merged.hourly : merged.daily;
  return {
    exportedAt: input.exportedAt,
    window: input.windowLabel,
    query: input.window,
    metric: input.metric,
    filters: { provider: input.selectedProvider, environmentIds: input.selectedEnvironmentIds },
    summary: {
      totalTokens: merged.totalTokens,
      uncachedInputTokens: merged.uncachedInputTokens,
      cachedInputTokens: merged.cachedInputTokens,
      cacheCreationTokens: merged.cacheCreationTokens,
      outputTokens: merged.outputTokens,
      reasoningTokens: merged.reasoningTokens,
      costUsd: merged.costUsd,
      records: merged.records,
      sessions: merged.sessions,
      costQuality: merged.costQuality,
    },
    coverage: {
      incomplete:
        input.coverageIncomplete === true ||
        merged.costQuality.unpricedShare > 0 ||
        merged.staleEnvironments.length > 0,
      contributingEnvironments: merged.contributingEnvironments,
      staleEnvironments: merged.staleEnvironments,
      duplicateSources: merged.duplicateSources,
    },
    providers: input.providers.map(({ provider, label }) => {
      const entry = merged.providers.find((item) => item.provider === provider);
      return {
        provider,
        label,
        costUsd: entry?.costUsd ?? 0,
        totalTokens: entry?.totalTokens ?? 0,
        sessions: entry?.sessions ?? 0,
        records: entry?.records ?? 0,
        unpricedRecords: entry?.unpricedRecords ?? 0,
        costShare: entry?.costShare ?? 0,
        tokenShare: entry?.tokenShare ?? 0,
      };
    }),
    models: merged.models,
    periods: periods.map((period) => ({
      ...period,
      hourStart:
        "hourStart" in period && typeof period.hourStart === "string"
          ? period.hourStart
          : undefined,
      byProvider: Object.fromEntries(period.byProvider),
    })),
  };
}

/** RFC 4180 quoting keeps commas, quotes and newlines inside a single cell. */
function csvCell(value: string | number): string {
  return typeof value === "number" ? String(value) : `"${value.replaceAll('"', '""')}"`;
}

export function usageReportCsv(report: ReturnType<typeof makeUsageReport>): string {
  const rows: (string | number)[][] = [
    ["T3 Code Usage Report"],
    ["Window", report.window],
    ["Time zone", report.query.timeZone],
    ["Exported At", report.exportedAt],
    ["Provider filter", report.filters.provider ?? "All harnesses"],
    ["Environment filter", report.filters.environmentIds?.join(", ") ?? "All environments"],
    [],
    ["Summary"],
    ["Total Tokens", report.summary.totalTokens],
    ["Uncached Input Tokens", report.summary.uncachedInputTokens],
    ["Cached Input Tokens", report.summary.cachedInputTokens],
    ["Cache Creation Tokens", report.summary.cacheCreationTokens],
    ["Output Tokens", report.summary.outputTokens],
    ["Reasoning Tokens", report.summary.reasoningTokens],
    ["Known Cost USD", report.summary.costUsd],
    [
      "Cost Coverage",
      report.coverage.incomplete
        ? "Incomplete; actual usage may be higher"
        : "Recorded API-equivalent estimate",
    ],
    ["Total Sessions", report.summary.sessions],
    ["Records", report.summary.records],
    ["Cache Savings USD", report.summary.costQuality.cacheSavingsUsd],
    ["Unpriced Record Share", report.summary.costQuality.unpricedShare],
    ["Provider Reported Record Share", report.summary.costQuality.providerReportedShare],
    ["Model Priced Record Share", report.summary.costQuality.modelPricedShare],
    [],
    ["Harness Breakdown"],
    ["Provider", "Total Tokens", "Known Cost USD", "Sessions", "Records", "Unpriced Records"],
    ...report.providers.map((provider) => [
      provider.label,
      provider.totalTokens,
      provider.costUsd,
      provider.sessions,
      provider.records,
      provider.unpricedRecords,
    ]),
    [],
    ["Model Breakdown"],
    ["Provider", "Model", "Total Tokens", "Known Cost USD", "Records", "Unpriced Records"],
    ...report.models.map((model) => [
      model.provider,
      model.model,
      model.totalTokens,
      model.costUsd,
      model.records,
      model.unpricedRecords ?? 0,
    ]),
    [],
    ["Timeline Breakdown"],
    [
      report.query.resolution === "hour" ? "Hour" : "Day",
      "Total Tokens",
      "Cost USD",
      ...report.providers.map((provider) => `${provider.label} Tokens`),
      ...report.providers.map((provider) => `${provider.label} Cost USD`),
    ],
    ...report.periods.map((period) => [
      period.hourStart ?? period.day,
      period.totalTokens,
      period.costUsd,
      ...report.providers.map(({ provider }) => period.byProvider[provider]?.totalTokens ?? 0),
      ...report.providers.map(({ provider }) => period.byProvider[provider]?.costUsd ?? 0),
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
