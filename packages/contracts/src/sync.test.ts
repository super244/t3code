/* agent-watermark: model=muse-spark; effort=high; duration=35m; seat=opencode; date=2026-10-10 */
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  SYNC_WS_METHODS,
  WS_SYNC_METHOD_META,
  forwardCommandFor,
  isStreamingSyncMethod,
  reverseCommandFor,
  syncMethodSupportsMode,
  SyncCheckpoint,
  SyncEventCursor,
  SyncStreamResume,
  REVERSE_STATE_PAIRS,
} from "./sync.ts";

const decodeCheckpoint = Schema.decodeUnknownSync(SyncCheckpoint);
const decodeCursor = Schema.decodeUnknownSync(SyncEventCursor);
const decodeResume = Schema.decodeUnknownSync(SyncStreamResume);

describe("sync wire contracts", () => {
  it("decodes a checkpoint cursor for resume", () => {
    expect(
      decodeCheckpoint({
        environmentId: "env-1",
        snapshotSequence: 42,
        checkpointRef: "ref-1",
        threadId: "thread-1",
        checkpointTurnCount: 3,
        updatedAt: "2026-10-10T00:00:00.000Z",
      }).snapshotSequence,
    ).toBe(42);
  });

  it("decodes per-env event cursors independently", () => {
    expect(
      decodeCursor({
        environmentId: "env-1",
        sequence: 7,
        updatedAt: "2026-10-10T00:00:00.000Z",
      }).sequence,
    ).toBe(7);
  });

  it("shares one resume shape across shell and thread subscriptions", () => {
    expect(decodeResume({ afterSequence: 9, requestCompletionMarker: true }).afterSequence).toBe(9);
    expect(decodeResume({}).afterSequence).toBeUndefined();
  });

  it("gives every forward a reverse and a visible shelf", () => {
    expect(reverseCommandFor("thread.snooze")).toBe("thread.unsnooze");
    expect(reverseCommandFor("thread.archive")).toBe("thread.unarchive");
    expect(reverseCommandFor("thread.settle")).toBe("thread.unsettle");
    expect(reverseCommandFor("thread.pin")).toBe("thread.unpin");
    expect(forwardCommandFor("thread.unsnooze")).toBe("thread.snooze");
    expect(forwardCommandFor("thread.unarchive")).toBe("thread.archive");
    // Close/reopen and snooze/unsnooze stay visible while hidden.
    for (const pair of REVERSE_STATE_PAIRS) {
      expect(pair.staysVisible).toBe(true);
    }
  });

  it("marks subscriptions streaming and dispatch idempotent by commandId", () => {
    expect(isStreamingSyncMethod(SYNC_WS_METHODS.subscribeShell)).toBe(true);
    expect(isStreamingSyncMethod(SYNC_WS_METHODS.dispatchCommand)).toBe(false);
    expect(WS_SYNC_METHOD_META[SYNC_WS_METHODS.dispatchCommand].idempotent).toBe(true);
    expect(isStreamingSyncMethod("unknown.method")).toBe(false);
  });

  it("supports subscriptions on all modes, mutations skip relay-only limits", () => {
    expect(syncMethodSupportsMode(SYNC_WS_METHODS.subscribeShell, "relay")).toBe(true);
    expect(syncMethodSupportsMode(SYNC_WS_METHODS.subscribeThread, "tunnel")).toBe(true);
    expect(syncMethodSupportsMode(SYNC_WS_METHODS.vcsPull, "local")).toBe(true);
  });
});
