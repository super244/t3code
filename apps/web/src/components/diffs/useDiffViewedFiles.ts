/* agent-watermark: model=haiku-5.5; effort=high; duration=45m; seat=claude-code; date=2026-10-12 */
import { useCallback, useState } from "react";

import {
  type DiffChangeEntry,
  type DiffViewedRecord,
  isDiffEntryViewed,
  parseDiffViewedRecord,
  withDiffEntryViewed,
} from "./diffChangesTree.logic";

// Browser storage can be missing, blocked, or full. A viewed mark is a per-viewer convenience,
// so every access degrades to "nothing saved" instead of breaking the diff.
function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readStoredRecord(storageKey: string | null): DiffViewedRecord {
  if (storageKey === null) return {};
  try {
    return parseDiffViewedRecord(browserStorage()?.getItem(storageKey) ?? null);
  } catch {
    return {};
  }
}

function writeStoredRecord(storageKey: string | null, record: DiffViewedRecord): void {
  if (storageKey === null) return;
  try {
    const storage = browserStorage();
    if (!storage) return;
    if (Object.keys(record).length === 0) {
      storage.removeItem(storageKey);
    } else {
      storage.setItem(storageKey, JSON.stringify(record));
    }
  } catch {
    // Quota or a blocked store: the mark still shows for this session.
  }
}

/**
 * Viewed marks for one thread's diff. The record reloads when the storage key changes (another
 * thread), and a mark applies only while the file still has the content version it was made at.
 */
export function useDiffViewedFiles(storageKey: string | null) {
  const [state, setState] = useState(() => ({
    storageKey,
    record: readStoredRecord(storageKey),
  }));
  let current = state;
  if (state.storageKey !== storageKey) {
    current = { storageKey, record: readStoredRecord(storageKey) };
    setState(current);
  }

  const isViewed = useCallback(
    (entry: DiffChangeEntry) => isDiffEntryViewed(current.record, entry),
    [current.record],
  );

  const setViewed = useCallback(
    (entries: ReadonlyArray<DiffChangeEntry>, entry: DiffChangeEntry, viewed: boolean) => {
      const record = withDiffEntryViewed(current.record, entries, entry, viewed);
      setState({ storageKey, record });
      writeStoredRecord(storageKey, record);
    },
    [current.record, storageKey],
  );

  return { isViewed, setViewed };
}
