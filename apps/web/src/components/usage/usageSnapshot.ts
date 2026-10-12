/* agent-watermark: model=haiku-5.5; effort=high; duration=12m; seat=claude-code; date=2026-10-12 */
/**
 * Last-known usage totals for this browser.
 *
 * The first answer from a server can take seconds, so the Usage page shows the
 * totals it last read for the same window instead of an empty skeleton. The
 * snapshot is per viewer, stored in localStorage, and labelled "last read" by
 * the page. It is never treated as current.
 */
import * as Schema from "effect/Schema";
import { UsageProviderKind } from "@t3tools/contracts";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";

const STORAGE_PREFIX = "t3code:usage-snapshot:v1:";

const UsageSnapshotSchema = Schema.Struct({
  savedAt: Schema.Number,
  costUsd: Schema.Number,
  totalTokens: Schema.Number,
  sessions: Schema.Number,
  cachedInputTokens: Schema.Number,
  uncachedInputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheSavingsUsd: Schema.Number,
  providers: Schema.Array(
    Schema.Struct({
      provider: UsageProviderKind,
      costUsd: Schema.Number,
      totalTokens: Schema.Number,
      sessions: Schema.Number,
    }),
  ),
});
export type UsageSnapshot = typeof UsageSnapshotSchema.Type;

/** Keys one snapshot per window, harness filter and environment selection. */
export function usageSnapshotKey(input: {
  readonly windowPreset: string;
  readonly provider: string | null;
  readonly environmentIds: readonly string[];
}): string {
  const environments = [...input.environmentIds].toSorted().join(",");
  return `${STORAGE_PREFIX}${input.windowPreset}|${input.provider ?? "all"}|${environments}`;
}

export function readUsageSnapshot(key: string): UsageSnapshot | null {
  try {
    return getLocalStorageItem(key, UsageSnapshotSchema);
  } catch {
    return null;
  }
}

export function writeUsageSnapshot(key: string, snapshot: UsageSnapshot): void {
  try {
    setLocalStorageItem(key, snapshot, UsageSnapshotSchema);
  } catch {
    // Storage can be blocked or full. The page still renders without a snapshot.
  }
}

/** Short, honest age for a snapshot, e.g. "just now", "12 min ago", "3 h ago". */
export function formatSnapshotAge(savedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - savedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}
