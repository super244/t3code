/* agent-watermark: model=muse-spark; effort=high; duration=35m; seat=opencode; date=2026-10-10 */
import type { SyncConnectionMode } from "@t3tools/contracts";

export type SyncShellStatus = "empty" | "cached" | "synchronizing" | "live";

export interface SyncConnectionModeInput {
  readonly reachability?: "loopback" | "lan" | "private-network" | "public" | string;
  readonly providerKind?: "core" | "private-network" | "tunnel" | "manual" | string;
  readonly relayManaged?: boolean;
  readonly httpBaseUrl?: string;
}

function isLoopbackUrl(httpBaseUrl: string | undefined): boolean {
  if (!httpBaseUrl) return false;
  try {
    const host = new URL(httpBaseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/**
 * One resolver for remote/relay/tunnel modes. Relay-managed endpoints always
 * ride the relay; advertised tunnel providers ride the tunnel; loopback stays
 * local; everything else is remote (direct LAN/Tailscale/manual).
 */
export function resolveSyncConnectionMode(input: SyncConnectionModeInput): SyncConnectionMode {
  if (input.relayManaged) return "relay";
  if (input.providerKind === "tunnel") return "tunnel";
  if (input.reachability === "loopback" || isLoopbackUrl(input.httpBaseUrl)) return "local";
  return "remote";
}

export interface SyncSequencedEvent {
  readonly sequence: number;
  readonly dedupeKey?: string;
}

/** Drop replays at or below the watermark; overlapping catch-up chunks dedupe by sequence. */
export function filterSyncEventsAfter<T extends SyncSequencedEvent>(
  events: ReadonlyArray<T>,
  afterSequence: number | null | undefined,
): ReadonlyArray<T> {
  const watermark = afterSequence ?? -1;
  return events.filter((event) => event.sequence > watermark);
}

/** Next watermark after applying events; null when nothing arrived. */
export function nextSyncSequence(
  events: ReadonlyArray<SyncSequencedEvent>,
  current: number,
): number {
  let next = current;
  for (const event of events) {
    if (event.sequence > next) next = event.sequence;
  }
  return next;
}

/** A shell event applies only when it advances the snapshot it patches. */
export function isSyncEventApplicable(eventSequence: number, snapshotSequence: number): boolean {
  return eventSequence > snapshotSequence;
}

export interface MultiEnvShellInput {
  readonly environmentId: string;
  readonly snapshotSequence: number;
  readonly updatedAt: string;
  readonly threadIds: ReadonlyArray<string>;
}

export interface MultiEnvSyncSummary {
  readonly totalEnvironments: number;
  readonly liveEnvironments: number;
  readonly synchronizingEnvironments: number;
  readonly staleEnvironments: number;
  readonly totalThreads: number;
  readonly latestUpdatedAt: string | null;
  readonly watermarks: Record<string, number>;
}

/** Merge per-env shells without cross-env sequence comparison (sequences are per-env). */
export function summarizeMultiEnvSync(shells: ReadonlyArray<MultiEnvShellInput>): MultiEnvSyncSummary {
  const watermarks: Record<string, number> = {};
  let totalThreads = 0;
  let latestUpdatedAt: string | null = null;
  for (const shell of shells) {
    watermarks[shell.environmentId] = shell.snapshotSequence;
    totalThreads += shell.threadIds.length;
    if (latestUpdatedAt === null || shell.updatedAt > latestUpdatedAt) {
      latestUpdatedAt = shell.updatedAt;
    }
  }
  return {
    totalEnvironments: shells.length,
    liveEnvironments: shells.length,
    synchronizingEnvironments: 0,
    staleEnvironments: 0,
    totalThreads,
    latestUpdatedAt,
    watermarks,
  };
}

export interface MultiEnvStatusInput {
  readonly status: SyncShellStatus;
  readonly updatedAt: string | null;
}

export interface MultiEnvStatusSummary {
  readonly total: number;
  readonly live: number;
  readonly synchronizing: number;
  readonly stale: number;
  readonly latestUpdatedAt: string | null;
}

/** Multi-env sync health: live vs synchronizing vs stale (cached/empty). */
export function summarizeMultiEnvStatus(states: ReadonlyArray<MultiEnvStatusInput>): MultiEnvStatusSummary {
  let live = 0;
  let synchronizing = 0;
  let latestUpdatedAt: string | null = null;
  for (const state of states) {
    if (state.status === "live") live += 1;
    if (state.status === "synchronizing") synchronizing += 1;
    if (state.updatedAt !== null && (latestUpdatedAt === null || state.updatedAt > latestUpdatedAt)) {
      latestUpdatedAt = state.updatedAt;
    }
  }
  return {
    total: states.length,
    live,
    synchronizing,
    stale: states.length - live - synchronizing,
    latestUpdatedAt,
  };
}

export type ReverseShelf = "inbox" | "snoozed" | "settled" | "archived";

export interface ReverseShelfThread {
  readonly archivedAt?: string | null | undefined;
  readonly settledAt?: string | null | undefined;
  readonly settledOverride?: "settled" | "active" | null | undefined;
  readonly snoozedUntil?: string | null | undefined;
}

function isSettledShelf(thread: ReverseShelfThread): boolean {
  return thread.settledOverride === "settled" || thread.settledAt != null;
}

/**
 * Reverse-state shelf. Close (archive) wins: a closed thread stays in the
 * archived shelf with an explicit reopen, never vanishing. Snooze is an
 * overlay on active threads with a future wake time; timer wakes need no
 * event, the fields simply stop classifying as snoozed.
 */
export function reverseShelfForThread(
  thread: ReverseShelfThread,
  options: { readonly now: string },
): ReverseShelf {
  if (thread.archivedAt != null) return "archived";
  const wakeMs = thread.snoozedUntil == null ? Number.NaN : Date.parse(thread.snoozedUntil);
  if (!Number.isNaN(wakeMs) && wakeMs > Date.parse(options.now)) return "snoozed";
  if (isSettledShelf(thread)) return "settled";
  return "inbox";
}

/** Close/reopen stays visible: an archived thread is always queryable with a reopen action. */
export function isCloseReopenVisible(thread: ReverseShelfThread): boolean {
  return thread.archivedAt != null;
}

/** Checkpoint applies only when it advances the snapshot it patches. */
export function isSyncCheckpointApplicable(
  checkpointSequence: number,
  snapshotSequence: number,
): boolean {
  return checkpointSequence >= snapshotSequence;
}
