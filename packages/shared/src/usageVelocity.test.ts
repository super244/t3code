/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=20m; seat=codex; date=2026-10-02 */
import {
  EnvironmentId,
  USAGE_CONTRACT_VERSION,
  UsageDay,
  type UsageSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { mergeUsage } from "./usageMerge.ts";
import { assessSpendBudget, usageComparisonCoverage } from "./usageVelocity.ts";

const summary: UsageSummary = {
  contractVersion: USAGE_CONTRACT_VERSION,
  readAt: "2026-10-02T12:00:00Z",
  timeZone: "UTC",
  sinceDay: UsageDay.make("2026-10-01"),
  untilDay: UsageDay.make("2026-10-02"),
  buckets: ["codex", "claude"].map((provider) => ({
    day: UsageDay.make("2026-10-01"),
    provider: provider as "codex" | "claude",
    model: "fixture",
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 10,
      reasoningTokens: 0,
    },
    costUsd: 10,
    cacheSavingsUsd: 0,
    costSource: "modelPriced",
    records: 1,
    unpricedRecords: 0,
    sessions: 1,
  })),
  sources: ["codex", "claude"].map((provider) => ({
    fingerprint: {
      provider: provider as "codex" | "claude",
      hostId: "fixture-machine",
      resolvedHomePath: `/fixture/${provider}`,
      volumeId: `volume-${provider}`,
    },
    status: "ok",
    scannedFiles: 1,
    skippedFiles: 0,
    malformedRecords: 0,
    distinctSessions: 1,
    message: null,
  })),
  pricing: { status: "fresh", source: "fixture", fetchedAt: null, knownModels: 1 },
  scanDurationMs: 1,
};
const environment = { summary, isPending: false, error: null };
const base = {
  unpricedShare: 0,
  staleEnvironmentCount: 0,
  provider: null,
  environments: [environment],
};

describe("usage comparison coverage", () => {
  it("keeps unavailable and refreshing history from appearing below target", () => {
    const incomplete = [
      { ...base, environments: [] },
      { ...base, staleEnvironmentCount: 1 },
      { ...base, environments: [{ ...environment, summary: null }] },
      { ...base, environments: [{ ...environment, isPending: true }] },
      { ...base, environments: [{ ...environment, error: "Offline" }] },
    ];
    for (const input of incomplete) {
      const comparisonCoverage = usageComparisonCoverage(input);
      expect(comparisonCoverage).toBe("partial");
      expect(
        assessSpendBudget({ monthlyBudgetUsd: 100, thirtyDayCostUsd: 0, comparisonCoverage })
          ?.status,
      ).toBe("unknown");
    }
  });

  it("grades only the selected harness's sources and pricing", () => {
    const partialSummary: UsageSummary = {
      ...summary,
      sources: summary.sources.map((source) =>
        source.fingerprint.provider === "codex" ? { ...source, status: "partial" } : source,
      ),
    };
    const summaries = [
      { environmentId: EnvironmentId.make("fixture"), label: "Fixture", summary: partialSummary },
    ];
    const merged = mergeUsage(summaries, USAGE_CONTRACT_VERSION, "claude");
    const input = {
      ...base,
      unpricedShare: merged.costQuality.unpricedShare,
      environments: [{ ...environment, summary: partialSummary }],
    };
    expect(usageComparisonCoverage(input)).toBe("partial");
    expect(usageComparisonCoverage({ ...input, provider: "claude" })).toBe("complete");
    expect(usageComparisonCoverage({ ...input, provider: "codex" })).toBe("partial");
  });

  it("carries real unpriced records through aggregation into an unknown comparison", () => {
    const unpricedSummary: UsageSummary = {
      ...summary,
      buckets: summary.buckets.map((bucket) =>
        bucket.provider === "codex"
          ? { ...bucket, costUsd: 0, costSource: "unpriced", unpricedRecords: 1 }
          : bucket,
      ),
    };
    const merged = mergeUsage(
      [
        {
          environmentId: EnvironmentId.make("fixture"),
          label: "Fixture",
          summary: unpricedSummary,
        },
      ],
      USAGE_CONTRACT_VERSION,
    );
    expect(merged.costQuality.unpricedShare).toBe(0.5);
    const comparisonCoverage = usageComparisonCoverage({
      ...base,
      unpricedShare: merged.costQuality.unpricedShare,
    });
    expect(comparisonCoverage).toBe("unpriced");
    expect(
      assessSpendBudget({
        monthlyBudgetUsd: 100,
        thirtyDayCostUsd: merged.costUsd,
        comparisonCoverage,
      }),
    ).toMatchObject({ status: "unknown", label: "Some usage has no price" });
  });

  it("retains compatible older Codex history without inventing coverage for newer harnesses", () => {
    const input = {
      ...base,
      environments: [{ ...environment, summary: { ...summary, contractVersion: 4 } }],
    };
    expect(usageComparisonCoverage(input)).toBe("partial");
    expect(usageComparisonCoverage({ ...input, provider: "codex" })).toBe("complete");
    expect(usageComparisonCoverage({ ...input, provider: "grok" })).toBe("partial");
    expect(usageComparisonCoverage({ ...input, provider: "antigravity" })).toBe("partial");
    expect(
      usageComparisonCoverage({
        ...input,
        provider: "grok",
        environments: [{ ...environment, summary: { ...summary, contractVersion: 5 } }],
      }),
    ).toBe("complete");
  });
});
