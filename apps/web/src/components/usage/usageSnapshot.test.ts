/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=12m; seat=codex; date=2026-10-15 */
/* agent-watermark: model=haiku-5.5; effort=high; duration=4m; seat=claude-code; date=2026-10-12 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  formatSnapshotAge,
  readUsageSnapshot,
  usageSnapshotKey,
  writeUsageSnapshot,
  type UsageSnapshot,
} from "./usageSnapshot";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const snapshot: UsageSnapshot = {
  savedAt: 1_000_000,
  costUsd: 12.5,
  unpricedShare: 0.25,
  totalTokens: 2_400_000,
  sessions: 9,
  cachedInputTokens: 1_000_000,
  uncachedInputTokens: 300_000,
  outputTokens: 80_000,
  cacheSavingsUsd: 4.25,
  providers: [{ provider: "codex", costUsd: 12.5, totalTokens: 2_400_000, sessions: 9 }],
};

describe("usage snapshot", () => {
  it("keys a snapshot by window, harness and the environments it covers", () => {
    const base = usageSnapshotKey({
      windowPreset: "30d",
      provider: null,
      environmentIds: ["env-b", "env-a"],
    });
    expect(
      usageSnapshotKey({ windowPreset: "30d", provider: null, environmentIds: ["env-a", "env-b"] }),
    ).toBe(base);
    expect(
      usageSnapshotKey({ windowPreset: "7d", provider: null, environmentIds: ["env-a", "env-b"] }),
    ).not.toBe(base);
    expect(
      usageSnapshotKey({
        windowPreset: "30d",
        provider: "codex",
        environmentIds: ["env-a", "env-b"],
      }),
    ).not.toBe(base);
  });

  it("round-trips the last totals read for a key", () => {
    const key = usageSnapshotKey({
      windowPreset: "30d",
      provider: null,
      environmentIds: ["env-a"],
    });
    expect(readUsageSnapshot(key)).toBeNull();
    writeUsageSnapshot(key, snapshot);
    expect(readUsageSnapshot(key)).toEqual(snapshot);
  });

  it("does not reuse totals from before pricing coverage was recorded", () => {
    const currentKey = usageSnapshotKey({
      windowPreset: "30d",
      provider: null,
      environmentIds: ["env-a"],
    });
    values.set("t3code:usage-snapshot:v1:30d|all|env-a", JSON.stringify(snapshot));
    expect(readUsageSnapshot(currentKey)).toBeNull();
  });

  it("treats corrupt stored values as no snapshot", () => {
    const key = usageSnapshotKey({
      windowPreset: "30d",
      provider: null,
      environmentIds: ["env-a"],
    });
    values.set(key, "{not json");
    expect(readUsageSnapshot(key)).toBeNull();
  });

  it("describes snapshot age without inventing precision", () => {
    expect(formatSnapshotAge(1_000_000, 1_000_000 + 20_000)).toBe("just now");
    expect(formatSnapshotAge(1_000_000, 1_000_000 + 12 * 60_000)).toBe("12 min ago");
    expect(formatSnapshotAge(1_000_000, 1_000_000 + 3 * 3_600_000)).toBe("3 h ago");
    expect(formatSnapshotAge(1_000_000, 1_000_000 + 2 * 86_400_000)).toBe("2 d ago");
  });
});
