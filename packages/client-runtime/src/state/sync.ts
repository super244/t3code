/* agent-watermark: model=muse-spark; effort=high; duration=35m; seat=opencode; date=2026-10-10 */
import type { EnvironmentId, OrchestrationThreadShell, SyncConnectionMode } from "@t3tools/contracts";
import {
  resolveSyncConnectionMode,
  reverseShelfForThread,
  summarizeMultiEnvStatus,
  type ReverseShelf,
  type SyncShellStatus,
} from "@t3tools/shared/sync";
import type { ConnectionTarget } from "../connection/model.ts";

export type { ReverseShelf };
export type { SyncConnectionMode };

export interface MultiEnvThreadRef {
  readonly environmentId: EnvironmentId;
  readonly thread: OrchestrationThreadShell;
}

export type ThreadsByShelf = Record<ReverseShelf, ReadonlyArray<MultiEnvThreadRef>>;

const EMPTY_PARTITION: ThreadsByShelf = {
  inbox: [],
  snoozed: [],
  settled: [],
  archived: [],
};

/**
 * Multi-env sync projection: every thread stays keyed by its environment and
 * lands on exactly one reverse-state shelf. Snoozed threads keep their
 * unsnooze, closed threads keep their reopen (`thread.unarchive`) — nothing
 * vanishes from queries when it leaves the inbox.
 */
export function partitionThreadsByShelf(
  refs: ReadonlyArray<MultiEnvThreadRef>,
  options: { readonly now: string },
): ThreadsByShelf {
  const inbox: MultiEnvThreadRef[] = [];
  const snoozed: MultiEnvThreadRef[] = [];
  const settled: MultiEnvThreadRef[] = [];
  const archived: MultiEnvThreadRef[] = [];
  for (const ref of refs) {
    switch (reverseShelfForThread(ref.thread, options)) {
      case "snoozed":
        snoozed.push(ref);
        break;
      case "settled":
        settled.push(ref);
        break;
      case "archived":
        archived.push(ref);
        break;
      default:
        inbox.push(ref);
        break;
    }
  }
  if (refs.length === 0) return EMPTY_PARTITION;
  return { inbox, snoozed, settled, archived };
}

export interface EnvironmentSyncStateInput {
  readonly status: SyncShellStatus;
  readonly updatedAt: string | null;
}

/** Thin runtime wrapper over the shared multi-env health summary. */
export function summarizeEnvironmentSync(states: ReadonlyArray<EnvironmentSyncStateInput>) {
  return summarizeMultiEnvStatus(states);
}

/**
 * Runtime connection-mode for a prepared target. Relay targets always ride
 * the relay; SSH/bearer remotes ride remote; primary resolves loopback to
 * local so the same code picks the right timeouts and resume strategy on
 * every surface without UI knowledge.
 */
export function describeConnectionModeForTarget(target: ConnectionTarget): SyncConnectionMode {
  switch (target._tag) {
    case "RelayConnectionTarget":
      return "relay";
    case "SshConnectionTarget":
    case "BearerConnectionTarget":
      return "remote";
    case "PrimaryConnectionTarget":
      return resolveSyncConnectionMode({ httpBaseUrl: target.httpBaseUrl });
  }
}
