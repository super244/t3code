/* agent-watermark: model=muse-spark; effort=high; duration=35m; seat=opencode; date=2026-10-10 */
import * as Schema from "effect/Schema";
import {
  CheckpointRef,
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TurnId,
} from "./baseSchemas.ts";

/**
 * Wire/sync v1: one connection-mode vocabulary for every transport.
 * `local` is a loopback environment, `remote` is direct LAN/Tailscale,
 * `relay` rides T3 Connect credentials, `tunnel` rides a managed endpoint
 * (Cloudflare tunnel or equivalent). Clients use this to pick timeouts,
 * resume strategy, and which WS methods to offer.
 */
export const SyncConnectionMode = Schema.Literals(["local", "remote", "relay", "tunnel"]);
export type SyncConnectionMode = typeof SyncConnectionMode.Type;
export const isSyncConnectionMode = Schema.is(SyncConnectionMode);

/**
 * Typed checkpoint cursor for resume. A checkpoint is the per-turn hidden git
 * ref plus the snapshot watermark that produced it, so a client resuming
 * after a reconnect can prove it already holds the turn's diff.
 */
export const SyncCheckpoint = Schema.Struct({
  environmentId: EnvironmentId,
  snapshotSequence: NonNegativeInt,
  checkpointRef: Schema.optional(CheckpointRef),
  threadId: Schema.optional(ThreadId),
  turnId: Schema.optional(TurnId),
  checkpointTurnCount: Schema.optional(NonNegativeInt),
  updatedAt: IsoDateTime,
});
export type SyncCheckpoint = typeof SyncCheckpoint.Type;

/** Per-environment event watermark. Monotonic per environment; never merged across envs. */
export const SyncEventCursor = Schema.Struct({
  environmentId: EnvironmentId,
  sequence: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type SyncEventCursor = typeof SyncEventCursor.Type;

/**
 * Env-agnostic resume shape. Mirrors `OrchestrationSubscribeShellInput` /
 * `OrchestrationSubscribeThreadInput` so shell and thread subscriptions share
 * one resume vocabulary: pass `afterSequence` to replay, ask for the
 * completion marker to know when catch-up ends and live begins.
 */
export const SyncStreamResume = Schema.Struct({
  afterSequence: Schema.optionalKey(NonNegativeInt),
  requestCompletionMarker: Schema.optionalKey(Schema.Boolean),
});
export type SyncStreamResume = typeof SyncStreamResume.Type;

/** Forward command that hides/moves a thread, and the command that undoes it. */
export const SyncReversePair = Schema.Struct({
  forward: Schema.Literals(["thread.snooze", "thread.archive", "thread.settle", "thread.pin"]),
  reverse: Schema.Literals([
    "thread.unsnooze",
    "thread.unarchive",
    "thread.unsettle",
    "thread.unpin",
  ]),
  /** Shelf the forward moves the thread to. The reverse returns it to the inbox. */
  shelf: Schema.Literals(["snoozed", "archived", "settled", "pinned"]),
  /** Reverse target stays queryable while hidden (close/reopen, snooze/unsnooze). */
  staysVisible: Schema.Boolean,
});
export type SyncReversePair = typeof SyncReversePair.Type;

/**
 * Every way in has a way out and a way to see it. `archived` is the
 * close/reopen pair: a closed thread stays in the archived shelf with an
 * explicit reopen (`thread.unarchive`), never vanishing from queries.
 */
export const REVERSE_STATE_PAIRS: ReadonlyArray<SyncReversePair> = [
  { forward: "thread.snooze", reverse: "thread.unsnooze", shelf: "snoozed", staysVisible: true },
  { forward: "thread.archive", reverse: "thread.unarchive", shelf: "archived", staysVisible: true },
  { forward: "thread.settle", reverse: "thread.unsettle", shelf: "settled", staysVisible: true },
  { forward: "thread.pin", reverse: "thread.unpin", shelf: "pinned", staysVisible: true },
];

export function reverseCommandFor(
  forward: SyncReversePair["forward"],
): SyncReversePair["reverse"] | null {
  return REVERSE_STATE_PAIRS.find((pair) => pair.forward === forward)?.reverse ?? null;
}

export function forwardCommandFor(
  reverse: SyncReversePair["reverse"],
): SyncReversePair["forward"] | null {
  return REVERSE_STATE_PAIRS.find((pair) => pair.reverse === reverse)?.forward ?? null;
}

/** WS method names relevant to wire/sync, as literal wire values. */
export const SYNC_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
  getArchivedShellSnapshot: "orchestration.getArchivedShellSnapshot",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  searchThreads: "orchestration.searchThreads",
  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsIntegrateWorktree: "vcs.integrateWorktree",
  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
} as const;
export type SyncWsMethod = (typeof SYNC_WS_METHODS)[keyof typeof SYNC_WS_METHODS];

export interface WsSyncMethodMeta {
  readonly streaming: boolean;
  /** Safe to retry with the same command/cursor (dedupe by commandId or sequence). */
  readonly idempotent: boolean;
  readonly modes: ReadonlyArray<SyncConnectionMode>;
}

const ALL_MODES: ReadonlyArray<SyncConnectionMode> = ["local", "remote", "relay", "tunnel"];

/** Typed WS contract table: streaming, idempotency, and per-mode support. */
export const WS_SYNC_METHOD_META: Record<SyncWsMethod, WsSyncMethodMeta> = {
  [SYNC_WS_METHODS.dispatchCommand]: { streaming: false, idempotent: true, modes: ALL_MODES },
  [SYNC_WS_METHODS.subscribeShell]: { streaming: true, idempotent: true, modes: ALL_MODES },
  [SYNC_WS_METHODS.subscribeThread]: { streaming: true, idempotent: true, modes: ALL_MODES },
  [SYNC_WS_METHODS.getArchivedShellSnapshot]: {
    streaming: false,
    idempotent: true,
    modes: ALL_MODES,
  },
  [SYNC_WS_METHODS.getTurnDiff]: { streaming: false, idempotent: true, modes: ALL_MODES },
  [SYNC_WS_METHODS.getFullThreadDiff]: { streaming: false, idempotent: true, modes: ALL_MODES },
  [SYNC_WS_METHODS.searchThreads]: { streaming: false, idempotent: true, modes: ALL_MODES },
  [SYNC_WS_METHODS.vcsPull]: {
    streaming: false,
    idempotent: false,
    modes: ["local", "remote", "tunnel"],
  },
  [SYNC_WS_METHODS.vcsRefreshStatus]: { streaming: false, idempotent: true, modes: ALL_MODES },
  [SYNC_WS_METHODS.vcsIntegrateWorktree]: {
    streaming: false,
    idempotent: false,
    modes: ["local", "remote", "tunnel"],
  },
  [SYNC_WS_METHODS.subscribeVcsStatus]: { streaming: true, idempotent: true, modes: ALL_MODES },
  [SYNC_WS_METHODS.subscribeServerConfig]: {
    streaming: true,
    idempotent: true,
    modes: ALL_MODES,
  },
  [SYNC_WS_METHODS.subscribeServerLifecycle]: {
    streaming: true,
    idempotent: true,
    modes: ALL_MODES,
  },
};

export function isStreamingSyncMethod(method: string): boolean {
  return (
    (WS_SYNC_METHOD_META as Record<string, WsSyncMethodMeta | undefined>)[method]?.streaming ===
    true
  );
}

export function syncMethodSupportsMode(method: string, mode: SyncConnectionMode): boolean {
  const meta = (WS_SYNC_METHOD_META as Record<string, WsSyncMethodMeta | undefined>)[method];
  return meta?.modes.includes(mode) ?? false;
}
