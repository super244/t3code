/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=grok-4.7; effort=default; duration=40m; seat=cursor; date=2026-09-30 */
import {
  USAGE_CONTRACT_VERSION,
  USAGE_MERGE_COMPATIBLE_SINCE,
  type EnvironmentId,
  type UsageBucket,
  type UsageDay,
  type UsageProviderKind,
  type UsageSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mergeUsage,
  selectUsageModels,
  type EnvironmentUsage,
  type ModelTotals,
} from "./usageMerge.ts";

function bucket(overrides: Partial<UsageBucket> = {}): UsageBucket {
  return {
    day: "2026-08-07" as UsageDay,
    provider: "claude",
    model: "claude-fable-5",
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    costUsd: 10,
    cacheSavingsUsd: 2,
    costSource: "modelPriced",
    records: 5,
    unpricedRecords: 0,
    sessions: 1,
    ...overrides,
  };
}

function summary(
  buckets: readonly UsageBucket[],
  sources: readonly {
    provider: UsageProviderKind;
    hostId: string;
    homePath: string;
    volumeId?: string;
    distinctSessions?: number;
  }[],
  contractVersion: number = USAGE_CONTRACT_VERSION,
): UsageSummary {
  return {
    contractVersion,
    readAt: "2026-08-07T00:00:00.000Z",
    timeZone: "UTC",
    sinceDay: "2026-08-01" as UsageDay,
    untilDay: "2026-08-31" as UsageDay,
    buckets,
    sources: sources.map((source) => ({
      fingerprint: {
        hostId: source.hostId,
        provider: source.provider,
        resolvedHomePath: source.homePath,
        volumeId: source.volumeId ?? `vol-${source.hostId}`,
      },
      status: "ok" as const,
      scannedFiles: 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: source.distinctSessions ?? 1,
      message: null,
    })),
    pricing: { status: "fresh", source: "litellm", fetchedAt: null, knownModels: 10 },
    scanDurationMs: 1,
  };
}

function environment(id: string, usageSummary: UsageSummary): EnvironmentUsage {
  return { environmentId: id as EnvironmentId, label: id, summary: usageSummary };
}

describe("mergeUsage", () => {
  it("sums environments that read different transcript directories", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary([bucket()], [{ provider: "claude", hostId: "mac", homePath: "/a/.claude" }]),
        ),
        environment(
          "env-b",
          summary([bucket()], [{ provider: "claude", hostId: "linux", homePath: "/b/.claude" }]),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(20);
    expect(merged.records).toBe(10);
    expect(merged.duplicateSources).toHaveLength(0);
  });

  it("counts a shared transcript directory once", () => {
    // Two worktree servers on one machine resolve the same provider home.
    const shared = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [shared])),
        environment("env-b", summary([bucket()], [shared])),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(10);
    expect(merged.records).toBe(5);
    expect(merged.sessions).toBe(1);
    expect(merged.duplicateSources).toHaveLength(1);
    expect(merged.contributingEnvironments).toEqual(["env-a"]);
  });

  it("drops only the duplicated provider, keeping the environment's other one", () => {
    const sharedClaude = {
      provider: "claude" as const,
      hostId: "mac",
      homePath: "/home/theo/.claude",
    };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [sharedClaude])),
        environment(
          "env-b",
          summary(
            [bucket(), bucket({ provider: "codex", model: "gpt-5.6-sol", costUsd: 4 })],
            [sharedClaude, { provider: "codex", hostId: "mac", homePath: "/home/theo/.codex" }],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    // env-b's claude bucket is dropped, its codex bucket survives.
    expect(merged.costUsd).toBe(14);
    expect(merged.providers.map((provider) => provider.provider).sort()).toEqual([
      "claude",
      "codex",
    ]);
    expect(merged.sessions).toBe(2);
    expect(
      Object.fromEntries(
        merged.providers.map((provider) => [provider.provider, provider.sessions]),
      ),
    ).toEqual({ claude: 1, codex: 1 });
  });

  it("excludes an environment reporting an older contract version", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary([bucket()], [{ provider: "claude", hostId: "mac", homePath: "/a" }]),
        ),
        environment(
          "env-b",
          summary(
            [bucket()],
            [{ provider: "claude", hostId: "linux", homePath: "/b" }],
            USAGE_MERGE_COMPATIBLE_SINCE - 1,
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(10);
    expect(merged.staleEnvironments).toEqual(["env-b"]);
  });

  it("keeps the previous compatible contract version so additive provider expansions still merge", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [bucket({ costUsd: 10 })],
            [{ provider: "claude", hostId: "mac", homePath: "/a" }],
          ),
        ),
        environment(
          "env-b",
          summary(
            [bucket({ costUsd: 4, provider: "codex", model: "gpt-5.6-sol" })],
            [{ provider: "codex", hostId: "linux", homePath: "/b" }],
            USAGE_CONTRACT_VERSION - 1,
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(14);
    expect(merged.staleEnvironments).toEqual([]);
  });

  it("derives provider shares and cost quality", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ costUsd: 75 }),
              bucket({ provider: "codex", model: "gpt-5.6-sol", costUsd: 25, unpricedRecords: 5 }),
            ],
            [
              { provider: "claude", hostId: "mac", homePath: "/a/.claude" },
              { provider: "codex", hostId: "mac", homePath: "/a/.codex" },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.providers[0]?.provider).toBe("claude");
    expect(merged.providers[0]?.costShare).toBeCloseTo(0.75, 5);
    expect(merged.costQuality.unpricedShare).toBeCloseTo(0.5, 5);
    expect(merged.costQuality.cacheSavingsUsd).toBe(4);
  });

  it("keeps two machines apart when hostname and home path collide", () => {
    // Every Mac resolves /Users/theo/.claude, so a hostname clash used to make
    // one machine's usage vanish. Filesystem identity separates them.
    const shape = { provider: "claude" as const, hostId: "mac", homePath: "/Users/theo/.claude" };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [{ ...shape, volumeId: "16777220:1234" }])),
        environment("env-b", summary([bucket()], [{ ...shape, volumeId: "16777221:9999" }])),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(20);
    expect(merged.duplicateSources).toHaveLength(0);
  });

  it("still collapses two servers reading the same directory", () => {
    const same = {
      provider: "claude" as const,
      hostId: "mac",
      homePath: "/Users/theo/.claude",
      volumeId: "16777220:1234",
    };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [same])),
        environment("env-b", summary([bucket()], [same])),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(10);
    expect(merged.duplicateSources).toHaveLength(1);
  });

  it("totals sessions from per-directory distinct counts, not per-bucket sums", () => {
    // One session that spans two days appears in two buckets. Summing bucket
    // sessions would say 2; the source's distinct count says 1.
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [bucket({ day: "2026-08-06" as UsageDay }), bucket({ day: "2026-08-07" as UsageDay })],
            [
              {
                provider: "claude",
                hostId: "mac",
                homePath: "/a/.claude",
                distinctSessions: 1,
              },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.sessions).toBe(1);
    expect(merged.providers[0]?.sessions).toBe(1);
  });

  it("returns empty totals with no environments", () => {
    const merged = mergeUsage([], USAGE_CONTRACT_VERSION);
    expect(merged.costUsd).toBe(0);
    expect(merged.daily).toHaveLength(0);
    expect(merged.hourly).toHaveLength(0);
  });

  it("omits providers with no sessions or usage", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [],
            [
              {
                provider: "claude",
                hostId: "mac",
                homePath: "/a/.claude",
                distinctSessions: 0,
              },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.providers).toEqual([]);
  });

  it("derives hourly totals without losing the daily rollup", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ hourStart: "2026-08-07T09:37:00.000Z", costUsd: 3 }),
              bucket({ hourStart: "2026-08-07T10:37:00.000Z", costUsd: 7 }),
            ],
            [{ provider: "claude", hostId: "mac", homePath: "/a/.claude" }],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.hourly.map((hour) => [hour.hourStart, hour.costUsd])).toEqual([
      ["2026-08-07T09:37:00.000Z", 3],
      ["2026-08-07T10:37:00.000Z", 7],
    ]);
    expect(merged.daily).toHaveLength(1);
    expect(merged.daily[0]?.costUsd).toBe(10);
  });
});

describe("provider-focused usage", () => {
  const sources = [
    { provider: "claude" as const, hostId: "mac", homePath: "/claude", distinctSessions: 3 },
    { provider: "codex" as const, hostId: "mac", homePath: "/codex", distinctSessions: 7 },
  ];
  const data = [
    environment(
      "a",
      summary(
        [
          bucket({ hourStart: "2026-08-07T12:00:00Z" }),
          bucket({
            provider: "codex",
            model: "gpt",
            costUsd: 20,
            cacheSavingsUsd: 8,
            records: 2,
            unpricedRecords: 1,
          }),
        ],
        sources,
      ),
    ),
  ];

  it("scopes tokens, unique sessions, cache savings and pricing quality before deriving shares", () => {
    const result = mergeUsage(data, USAGE_CONTRACT_VERSION, "claude");
    expect(result.costUsd).toBe(10);
    expect(result.totalTokens).toBe(1160);
    expect(result.sessions).toBe(3);
    expect(result.cachedInputTokens).toBe(1000);
    expect(result.cacheCreationTokens).toBe(10);
    expect(result.costQuality).toEqual({
      cacheSavingsUsd: 2,
      providerReportedShare: 0,
      modelPricedShare: 1,
      unpricedShare: 0,
    });
    expect(
      result.providers.map((entry) => [entry.provider, entry.costShare, entry.tokenShare]),
    ).toEqual([["claude", 1, 1]]);
    expect(result.models.map((entry) => entry.model)).toEqual(["claude-fable-5"]);
    expect([...result.hourly[0]!.byProvider.keys()]).toEqual(["claude"]);
    expect([...result.daily[0]!.byProvider.keys()]).toEqual(["claude"]);
  });

  it("deduplicates selected sources and hides duplicate diagnostics from excluded harnesses", () => {
    const environments = [...data, environment("b", summary([bucket()], [sources[0]!]))];
    expect(mergeUsage(environments, USAGE_CONTRACT_VERSION, "claude").sessions).toBe(3);
    expect(
      mergeUsage(environments, USAGE_CONTRACT_VERSION, "claude").duplicateSources,
    ).toHaveLength(1);
    expect(mergeUsage(environments, USAGE_CONTRACT_VERSION, "codex").duplicateSources).toEqual([]);
  });

  it("restores all providers without mutating source summaries", () => {
    mergeUsage(data, USAGE_CONTRACT_VERSION, "claude");
    const all = mergeUsage(data, USAGE_CONTRACT_VERSION, null);
    expect(all.costUsd).toBe(30);
    expect(all.sessions).toBe(10);
    expect(data[0]!.summary.buckets).toHaveLength(2);
    expect(data[0]!.summary.sources).toHaveLength(2);
  });

  it("returns honest empty totals when the selected harness has no sources", () => {
    const result = mergeUsage(data, USAGE_CONTRACT_VERSION, "grok");
    expect(result.totalTokens).toBe(0);
    expect(result.sessions).toBe(0);
    expect(result.contributingEnvironments).toEqual([]);
    expect(result.models).toEqual([]);
  });

  it.each(["claude", "codex", "grok", "opencode", "antigravity"] as const)(
    "supports %s without a contract change",
    (provider) => {
      const environmentUsage = environment(
        "a",
        summary([bucket({ provider })], [{ provider, hostId: "mac", homePath: `/${provider}` }]),
      );
      expect(mergeUsage([environmentUsage], USAGE_CONTRACT_VERSION, provider).costUsd).toBe(10);
    },
  );
});

describe("model breakdown focus", () => {
  const models: readonly ModelTotals[] = [
    {
      provider: "claude",
      model: "capable",
      costUsd: 10,
      totalTokens: 200,
      records: 1,
      costShare: 0.8,
    },
    {
      provider: "codex",
      model: "fast",
      costUsd: 2,
      totalTokens: 1000,
      records: 1,
      costShare: 0.16,
    },
    {
      provider: "codex",
      model: "small",
      costUsd: 0.5,
      totalTokens: 100,
      records: 1,
      costShare: 0.04,
    },
  ];
  it("ranks tokens independently of cost without mutating the merged rows", () => {
    expect(selectUsageModels(models, { metric: "tokens" }).map((row) => row.model)).toEqual([
      "fast",
      "capable",
      "small",
    ]);
    expect(models[0]?.model).toBe("capable");
    expect(selectUsageModels(models, { metric: "cost" })[0]?.model).toBe("capable");
  });
  it("searches model names and harnesses case-insensitively, retaining original cost shares", () => {
    expect(selectUsageModels(models, { metric: "cost", query: "  CODEX  " })).toEqual([
      models[1],
      models[2],
    ]);
    expect(selectUsageModels(models, { metric: "cost", query: "FAST", provider: "codex" })).toEqual(
      [models[1]],
    );
    expect(
      selectUsageModels(models, { metric: "cost", query: "fast", provider: "claude" }),
    ).toEqual([]);
    expect(selectUsageModels(models, { metric: "cost", query: "missing" })).toEqual([]);
  });
});
