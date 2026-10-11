import type {
  EnvironmentId,
  UsageProjectTotals,
  UsageProviderKind,
  UsageSourceFingerprint,
  UsageSummary,
} from "@t3tools/contracts";

export interface ProjectUsage {
  /** Stable row key: the resolved path, or the label when the path is unknown. */
  readonly key: string;
  readonly name: string;
  readonly projectPath: string | null;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly sessions: number;
  readonly providers: readonly UsageProviderKind[];
  /** Most expensive models across environments, largest first. */
  readonly models: readonly {
    readonly model: string;
    readonly costUsd: number;
    readonly totalTokens: number;
  }[];
  /** Share of the window's attributed cost, 0–1. */
  readonly costShare: number;
}

export interface ProjectUsageSummary {
  readonly projects: readonly ProjectUsage[];
  /** True when at least one environment predates per-project usage. */
  readonly partial: boolean;
}

const fingerprintKey = (f: UsageSourceFingerprint) =>
  [f.hostId, f.provider, f.resolvedHomePath, f.volumeId].join(" ");

const tokensOf = (row: UsageProjectTotals) =>
  row.totals.uncachedInputTokens +
  row.totals.cachedInputTokens +
  row.totals.cacheCreationTokens +
  row.totals.outputTokens;

/**
 * Per-project usage across environments, with the same ownership rule as
 * `mergeUsage`: when two environments read one transcript directory, the
 * environment with the lowest id counts it and the other's rows for that
 * provider are dropped.
 */
export function mergeUsageProjects(
  environments: readonly {
    readonly environmentId: EnvironmentId;
    readonly summary: UsageSummary;
  }[],
  filter: { readonly provider?: UsageProviderKind | null } = {},
): ProjectUsageSummary {
  const ordered = [...environments].sort((a, b) => a.environmentId.localeCompare(b.environmentId));
  const owner = new Map<string, EnvironmentId>();
  for (const environment of ordered) {
    for (const source of environment.summary.sources) {
      if (source.status === "missing") continue;
      const key = fingerprintKey(source.fingerprint);
      if (!owner.has(key)) owner.set(key, environment.environmentId);
    }
  }

  let partial = false;
  const merged = new Map<
    string,
    {
      name: string;
      projectPath: string | null;
      costUsd: number;
      totalTokens: number;
      sessions: number;
      providers: Set<UsageProviderKind>;
      models: Map<string, { costUsd: number; totalTokens: number }>;
    }
  >();
  for (const environment of ordered) {
    if (environment.summary.projects === undefined) {
      partial = true;
      continue;
    }
    const owned = new Set<UsageProviderKind>();
    for (const source of environment.summary.sources) {
      if (source.status === "missing") continue;
      if (owner.get(fingerprintKey(source.fingerprint)) === environment.environmentId) {
        owned.add(source.fingerprint.provider);
      }
    }
    for (const row of environment.summary.projects) {
      if (!owned.has(row.provider)) continue;
      if (filter.provider && row.provider !== filter.provider) continue;
      const key = row.projectPath ?? `~${row.name}`;
      const entry = merged.get(key) ?? {
        name: row.name,
        projectPath: row.projectPath,
        costUsd: 0,
        totalTokens: 0,
        sessions: 0,
        providers: new Set<UsageProviderKind>(),
        models: new Map<string, { costUsd: number; totalTokens: number }>(),
      };
      entry.costUsd += row.costUsd;
      entry.totalTokens += tokensOf(row);
      entry.sessions += row.sessions;
      entry.providers.add(row.provider);
      for (const model of row.models ?? []) {
        const current = entry.models.get(model.model) ?? { costUsd: 0, totalTokens: 0 };
        current.costUsd += model.costUsd;
        current.totalTokens += model.totalTokens;
        entry.models.set(model.model, current);
      }
      merged.set(key, entry);
    }
  }

  const totalCost = [...merged.values()].reduce((sum, entry) => sum + entry.costUsd, 0);
  const projects = [...merged.entries()]
    .map(([key, entry]) => ({
      key,
      name: entry.name,
      projectPath: entry.projectPath,
      costUsd: entry.costUsd,
      totalTokens: entry.totalTokens,
      sessions: entry.sessions,
      providers: [...entry.providers].sort(),
      models: [...entry.models.entries()]
        .map(([model, totals]) => ({ model, ...totals }))
        .sort((a, b) => b.costUsd - a.costUsd)
        .slice(0, 6),
      costShare: totalCost > 0 ? entry.costUsd / totalCost : 0,
    }))
    .sort(
      (a, b) =>
        b.costUsd - a.costUsd || b.totalTokens - a.totalTokens || a.name.localeCompare(b.name),
    );
  return { projects, partial };
}
