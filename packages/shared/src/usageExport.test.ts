/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-01 */
import { UsageDay, USAGE_CONTRACT_VERSION } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { makeUsageReport, usageReportCsv, type UsageReportInput } from "./usageExport.ts";
import { mergeUsage } from "./usageMerge.ts";

function input(): UsageReportInput {
  const merged = mergeUsage([], USAGE_CONTRACT_VERSION);
  const byProvider = new Map([["codex" as const, { totalTokens: 100, costUsd: 2 }]]);
  return {
    merged: {
      ...merged,
      totalTokens: 100,
      costUsd: 2,
      cacheCreationTokens: 10,
      providers: [
        {
          provider: "codex",
          totalTokens: 100,
          costUsd: 2,
          records: 1,
          sessions: 1,
          costShare: 1,
          tokenShare: 1,
        },
      ],
      daily: [{ day: "2026-10-01", totalTokens: 100, costUsd: 2, byProvider }],
      hourly: [
        {
          day: "2026-10-01",
          hourStart: "2026-10-01T12:00:00Z",
          totalTokens: 100,
          costUsd: 2,
          byProvider,
        },
      ],
      models: [
        {
          provider: "codex",
          model: 'model,"custom"\nsecond line',
          totalTokens: 100,
          costUsd: 2,
          records: 1,
          costShare: 1,
        },
      ],
    },
    window: {
      sinceDay: UsageDay.make("2026-10-01"),
      untilDay: UsageDay.make("2026-10-01"),
      timeZone: "America/Vancouver",
    },
    windowLabel: "Oct 1",
    metric: "tokens",
    exportedAt: "2026-10-01T12:00:00Z",
    selectedProvider: "codex",
    selectedEnvironmentIds: ["my-machine"],
    providers: [{ provider: "codex", label: "Codex" }],
  };
}

describe("portable usage reports", () => {
  it("preserves provider timeline values through a JSON round trip and includes focus and coverage", () => {
    const report = makeUsageReport(input());
    const json = JSON.parse(JSON.stringify(report));
    expect(json.periods[0].byProvider).toEqual({ codex: { totalTokens: 100, costUsd: 2 } });
    expect(json.filters).toEqual({ provider: "codex", environmentIds: ["my-machine"] });
    expect(json.summary.cacheCreationTokens).toBe(10);
    expect(json.coverage).toEqual({
      contributingEnvironments: [],
      duplicateSources: [],
      staleEnvironments: [],
    });
  });

  it("exports rolling hourly bucket identities and keeps the original maps intact", () => {
    const data = input();
    const report = makeUsageReport({
      ...data,
      window: {
        ...data.window,
        resolution: "hour",
        sinceTime: "2026-10-01T11:00:00Z",
        untilTime: "2026-10-01T13:00:00Z",
      },
    });
    expect(report.periods[0]).toHaveProperty("hourStart", "2026-10-01T12:00:00Z");
    expect(data.merged.hourly[0]!.byProvider).toBeInstanceOf(Map);
    expect(usageReportCsv(report)).toContain('"2026-10-01T12:00:00Z",100,2,100,2');
  });

  it("escapes quotes, commas and multiline model IDs in CSV and records applied filters", () => {
    const csv = usageReportCsv(makeUsageReport(input()));
    expect(csv).toContain('"model,""custom""\nsecond line"');
    expect(csv).toContain('"Provider filter","codex"');
    expect(csv).toContain('"Environment filter","my-machine"');
    expect(csv).toContain('"2026-10-01",100,2,100,2');
    expect(csv).toContain('"Cache Creation Tokens",10');
  });

  it("exports quiet selected providers as zero and All without inventing usage", () => {
    const data = input();
    const report = makeUsageReport({
      ...data,
      merged: mergeUsage([], USAGE_CONTRACT_VERSION),
      selectedProvider: null,
      selectedEnvironmentIds: null,
    });
    expect(report.providers[0]!.totalTokens).toBe(0);
    expect(report.periods).toEqual([]);
    expect(usageReportCsv(report)).toContain('"Provider filter","All harnesses"');
  });
});
