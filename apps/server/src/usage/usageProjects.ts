/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=60m; seat=codex; date=2026-10-15 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=15m; seat=codex; date=2026-10-14 */
import type { UsageProjectTotals, UsageProviderKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { priceUsage, type RateTable } from "./usagePricing.ts";
import { addTotals, EMPTY_TOTALS, type UsageRecord } from "./usageTranscripts.ts";

/** Claude Code names a project's transcript folder after its cwd, every non-alphanumeric as `-`. */
const slugify = (segment: string) => segment.replace(/[^a-zA-Z0-9]/g, "-");

const MAX_DEPTH = 24;

const joinPath = (dir: string, name: string) =>
  dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
const baseName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

/**
 * Resolves a Claude Code project folder name back to the directory it came from.
 *
 * The encoding is lossy (`/`, `.`, `-` and `_` all become `-`), so the name is
 * matched against the real filesystem one segment at a time, preferring the
 * longest entry name that fits. Succeeds with `null` when no existing path
 * produces the slug, which is the honest answer for a deleted project.
 */
export const resolveClaudeProjectSlug = (
  slug: string,
  readDir: (path: string) => Effect.Effect<readonly string[]>,
): Effect.Effect<string | null> => {
  const walk = (dir: string, rest: string, depth: number): Effect.Effect<string | null> =>
    Effect.gen(function* () {
      if (rest.length === 0) return dir;
      if (depth > MAX_DEPTH || !rest.startsWith("-")) return null;
      const remaining = rest.slice(1);
      const names = yield* readDir(dir);
      const candidates = names
        .filter((name) => {
          const encoded = slugify(name);
          return remaining === encoded || remaining.startsWith(`${encoded}-`);
        })
        .toSorted((a, b) => b.length - a.length);
      for (const name of candidates) {
        const found = yield* walk(
          joinPath(dir, name),
          remaining.slice(slugify(name).length),
          depth + 1,
        );
        if (found !== null) return found;
      }
      return null;
    });
  return slug.startsWith("-") ? walk("/", slug, 0) : Effect.succeed(null);
};

export interface TranscriptProject {
  readonly projectPath: string | null;
  readonly name: string;
}

const UNATTRIBUTED: TranscriptProject = { projectPath: null, name: "Not recorded" };

/** The Claude Code project folder a transcript sits in, relative to the transcript root. */
export function claudeProjectSlug(root: string, filePath: string): string | null {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (!filePath.startsWith(prefix)) return null;
  const slug = filePath.slice(prefix.length).split("/")[0];
  return slug !== undefined && slug.length > 0 ? slug : null;
}

/**
 * Projects for every Claude Code folder in the scan, resolved once each.
 * Only Claude Code encodes the cwd in its layout; other providers report
 * `Not recorded` rather than a guess.
 */
export const resolveTranscriptProjects = (
  slugs: Iterable<string>,
  readDir: (path: string) => Effect.Effect<readonly string[]>,
): Effect.Effect<
  (provider: UsageProviderKind, root: string, filePath: string) => TranscriptProject
> =>
  Effect.gen(function* () {
    const bySlug = new Map<string, TranscriptProject>();
    for (const slug of new Set(slugs)) {
      const resolved = yield* resolveClaudeProjectSlug(slug, readDir);
      bySlug.set(
        slug,
        resolved === null
          ? {
              projectPath: null,
              name: slug.replace(/^-+/, "").split("-").slice(-2).join("-") || slug,
            }
          : { projectPath: resolved, name: baseName(resolved) },
      );
    }
    return (provider, root, filePath) => {
      if (provider !== "claude") return UNATTRIBUTED;
      const slug = claudeProjectSlug(root, filePath);
      return (slug === null ? undefined : bySlug.get(slug)) ?? UNATTRIBUTED;
    };
  });

interface MutableProject {
  sourceId: string;
  provider: UsageProviderKind;
  project: TranscriptProject;
  totals: UsageProjectTotals["totals"];
  costUsd: number;
  records: number;
  sessions: Set<string>;
  models: Map<string, { costUsd: number; totalTokens: number }>;
}

const MODELS_PER_PROJECT = 6;

/** Folds records that already passed the window and dedupe checks into per-project totals. */
export class UsageProjectAggregator {
  readonly #projects = new Map<string, MutableProject>();
  readonly #rates: RateTable;
  readonly #priceOverrides: RateTable | undefined;

  constructor(rates: RateTable, priceOverrides?: RateTable) {
    this.#rates = rates;
    this.#priceOverrides = priceOverrides;
  }

  add(project: TranscriptProject, record: UsageRecord, sourceId = ""): void {
    const key = `${record.provider}\u0000${project.projectPath ?? `~${project.name}`}\u0000${sourceId}`;
    let entry = this.#projects.get(key);
    if (entry === undefined) {
      entry = {
        sourceId,
        provider: record.provider,
        project,
        totals: EMPTY_TOTALS,
        costUsd: 0,
        records: 0,
        sessions: new Set(),
        models: new Map(),
      };
      this.#projects.set(key, entry);
    }
    entry.totals = addTotals(entry.totals, record.totals);
    const recordCost = priceUsage(
      this.#rates,
      record.model,
      record.totals,
      record.reportedCostUsd,
      this.#priceOverrides,
      record.cacheCreation1hTokens,
      record.pricingUnsupported,
    ).costUsd;
    entry.costUsd += recordCost;
    const model = entry.models.get(record.model) ?? { costUsd: 0, totalTokens: 0 };
    model.costUsd += recordCost;
    model.totalTokens +=
      record.totals.uncachedInputTokens +
      record.totals.cachedInputTokens +
      record.totals.cacheCreationTokens +
      record.totals.outputTokens;
    entry.models.set(record.model, model);
    entry.records += 1;
    if (record.sessionId.length > 0) entry.sessions.add(record.sessionId);
  }

  finish(): UsageProjectTotals[] {
    return [...this.#projects.values()]
      .map((entry) => ({
        ...(entry.sourceId ? { sourceId: entry.sourceId } : {}),
        provider: entry.provider,
        projectPath: entry.project.projectPath,
        name: entry.project.name,
        totals: entry.totals,
        costUsd: entry.costUsd,
        records: entry.records,
        sessions: entry.sessions.size,
        models: [...entry.models.entries()]
          .map(([model, totals]) => ({ model, ...totals }))
          .toSorted((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens)
          .slice(0, MODELS_PER_PROJECT),
      }))
      .sort((a, b) => b.costUsd - a.costUsd || a.name.localeCompare(b.name));
  }
}
