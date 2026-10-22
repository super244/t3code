/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=20m; seat=codex; date=2026-10-17 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=7m; seat=codex; date=2026-10-15 */
/** Usage evidence outlives transcript files and the disposable parse cache. */
import { decodeScanCache, encodeScanCache, type ScanCache } from "./usageScanCache.ts";
import { totalTokens, type UsageRecord } from "./usageTranscripts.ts";

/** Decode known historical formats without trusting their parser resume positions. */
export function decodeUsageHistory(document: unknown): ScanCache {
  if (typeof document !== "object" || document === null) return new Map();
  const root = document as Record<string, unknown>;
  if (
    ![1, 2].includes(Number(root.historyVersion)) &&
    ![5, 8, 9, 10].includes(Number(root.version))
  )
    return new Map();
  const legacy = root.historyVersion !== 1 && root.version === 5;
  if (typeof root.files !== "object" || root.files === null) return new Map();
  const files: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(root.files)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    const migrate = (rows: unknown) =>
      Array.isArray(rows)
        ? rows.map((row: unknown) => {
            if (!Array.isArray(row)) return row;
            const next: unknown[] = [...row];
            if (legacy && next.length === 11) next.push(false);
            // Original Claude accounting preserves every usage row. Older ledgers
            // may carry message IDs, but those must not suppress rows after migration.
            if (entry.p === "claude") next[8] = null;
            return next;
          })
        : rows;
    files[path] = { ...entry, r: migrate(entry.r), t: migrate(entry.t) };
  }
  const decoded = decodeScanCache({ ...root, version: encodeScanCache(new Map()).version, files });
  for (const [path, entry] of decoded) {
    const observed = (record: UsageRecord) =>
      !["<synthetic>", "synthetic"].includes(record.model) &&
      (totalTokens(record.totals) > 0 || (record.reportedCostUsd ?? 0) > 0);
    decoded.set(path, {
      ...entry,
      records: entry.records.filter(observed),
      tailRecords: entry.tailRecords.filter(observed),
    });
  }
  return decoded;
}

/** Retain requests removed by rotation; preserve multiplicity where no identity exists. */
export function mergeUsageHistoryRecords(
  previous: readonly UsageRecord[],
  current: readonly UsageRecord[],
): readonly UsageRecord[] {
  const keyed = new Map<string, UsageRecord>();
  const anonymous = (record: UsageRecord) =>
    JSON.stringify([
      record.provider,
      record.timestampMs,
      record.model,
      record.sessionId,
      record.totals.uncachedInputTokens,
      record.totals.cachedInputTokens,
      record.totals.cacheCreationTokens,
      record.totals.outputTokens,
    ]);
  const counts = new Map<string, number>();
  const unkeyed: UsageRecord[] = [];
  for (const record of current) {
    if (record.dedupeKey !== null) keyed.set(record.dedupeKey, record);
    else {
      unkeyed.push(record);
      const key = anonymous(record);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const record of previous) {
    if (record.dedupeKey === null) {
      const key = anonymous(record);
      const count = counts.get(key) ?? 0;
      if (count > 0) counts.set(key, count - 1);
      else unkeyed.push(record);
      continue;
    }
    const latest = keyed.get(record.dedupeKey);
    if (!latest) keyed.set(record.dedupeKey, record);
  }
  return [...keyed.values(), ...unkeyed];
}

/** Standard transcript roots can be recovered even when the old directory is gone. */
export function usageHistoryRoot(filePath: string): string {
  for (const marker of ["/projects/", "/archived_sessions/", "/sessions/"]) {
    const index = filePath.indexOf(marker);
    if (index >= 0) return filePath.slice(0, index + marker.length - 1);
  }
  return filePath.slice(0, filePath.lastIndexOf("/"));
}
