/* agent-watermark: model=muse-spark; effort=high; duration=35m; seat=opencode; date=2026-10-10 */
import { describe, expect, it } from "vite-plus/test";
import {
  filterSyncEventsAfter,
  isCloseReopenVisible,
  isSyncCheckpointApplicable,
  isSyncEventApplicable,
  nextSyncSequence,
  resolveSyncConnectionMode,
  reverseShelfForThread,
  summarizeMultiEnvStatus,
  summarizeMultiEnvSync,
} from "./sync.ts";

const NOW = "2026-10-10T12:00:00.000Z";

describe("resolveSyncConnectionMode", () => {
  it("keeps loopback local", () => {
    expect(
      resolveSyncConnectionMode({
        reachability: "loopback",
        httpBaseUrl: "http://localhost:3930/",
      }),
    ).toBe("local");
    expect(resolveSyncConnectionMode({ httpBaseUrl: "http://127.0.0.1:3930/" })).toBe("local");
  });

  it("prefers relay when managed and tunnel for tunnel providers", () => {
    expect(resolveSyncConnectionMode({ relayManaged: true, providerKind: "tunnel" })).toBe("relay");
    expect(resolveSyncConnectionMode({ providerKind: "tunnel" })).toBe("tunnel");
  });

  it("treats everything else as remote", () => {
    expect(
      resolveSyncConnectionMode({ reachability: "lan", httpBaseUrl: "http://192.168.1.2:3930/" }),
    ).toBe("remote");
    expect(resolveSyncConnectionMode({})).toBe("remote");
  });
});

describe("sync event sequencing", () => {
  it("drops replays at or below the watermark", () => {
    const events = [{ sequence: 5 }, { sequence: 6 }, { sequence: 7 }];
    expect(filterSyncEventsAfter(events, 6)).toEqual([{ sequence: 7 }]);
    expect(filterSyncEventsAfter(events, null)).toEqual(events);
  });

  it("advances the watermark monotonically", () => {
    expect(nextSyncSequence([{ sequence: 6 }, { sequence: 9 }], 5)).toBe(9);
    expect(nextSyncSequence([{ sequence: 3 }], 5)).toBe(5);
  });

  it("applies shell events and checkpoints only when they advance", () => {
    expect(isSyncEventApplicable(8, 7)).toBe(true);
    expect(isSyncEventApplicable(7, 7)).toBe(false);
    expect(isSyncCheckpointApplicable(7, 7)).toBe(true);
    expect(isSyncCheckpointApplicable(6, 7)).toBe(false);
  });
});

describe("multi-env sync", () => {
  it("merges per-env shells with per-env watermarks", () => {
    const summary = summarizeMultiEnvSync([
      {
        environmentId: "env-a",
        snapshotSequence: 10,
        updatedAt: "2026-10-10T10:00:00.000Z",
        threadIds: ["t1", "t2"],
      },
      {
        environmentId: "env-b",
        snapshotSequence: 4,
        updatedAt: "2026-10-10T11:00:00.000Z",
        threadIds: ["t3"],
      },
    ]);
    expect(summary.totalEnvironments).toBe(2);
    expect(summary.totalThreads).toBe(3);
    expect(summary.watermarks).toEqual({ "env-a": 10, "env-b": 4 });
    expect(summary.latestUpdatedAt).toBe("2026-10-10T11:00:00.000Z");
  });

  it("reports live vs synchronizing vs stale health", () => {
    const health = summarizeMultiEnvStatus([
      { status: "live", updatedAt: "2026-10-10T10:00:00.000Z" },
      { status: "synchronizing", updatedAt: null },
      { status: "cached", updatedAt: "2026-10-10T09:00:00.000Z" },
    ]);
    expect(health).toEqual({
      total: 3,
      live: 1,
      synchronizing: 1,
      stale: 1,
      latestUpdatedAt: "2026-10-10T10:00:00.000Z",
    });
  });
});

describe("reverse states stay visible", () => {
  it("keeps snooze/unsnooze in the snoozed shelf until the wake passes", () => {
    expect(reverseShelfForThread({ snoozedUntil: "2026-10-11T09:00:00.000Z" }, { now: NOW })).toBe(
      "snoozed",
    );
    expect(reverseShelfForThread({ snoozedUntil: "2026-10-09T09:00:00.000Z" }, { now: NOW })).toBe(
      "inbox",
    );
  });

  it("keeps close/reopen in the archived shelf with a queryable reopen", () => {
    const closed = { archivedAt: "2026-10-10T09:00:00.000Z" };
    expect(reverseShelfForThread(closed, { now: NOW })).toBe("archived");
    expect(isCloseReopenVisible(closed)).toBe(true);
    expect(isCloseReopenVisible({ archivedAt: null })).toBe(false);
  });

  it("lets close win over snooze and settle", () => {
    expect(
      reverseShelfForThread(
        {
          archivedAt: "2026-10-10T09:00:00.000Z",
          snoozedUntil: "2026-10-11T09:00:00.000Z",
          settledAt: "2026-10-10T08:00:00.000Z",
        },
        { now: NOW },
      ),
    ).toBe("archived");
    expect(reverseShelfForThread({ settledAt: "2026-10-10T08:00:00.000Z" }, { now: NOW })).toBe(
      "settled",
    );
  });
});
