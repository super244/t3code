/* agent-watermark: model=opus-5.5; effort=high; duration=7m; seat=claude-code; date=2026-10-19 */
import type { EnvironmentId, ModelSelection, ProjectId, ThreadId } from "@t3tools/contracts";

/**
 * One "Race this prompt" dialog for the whole app. The composer, every
 * thread menu and the command palette open it here; the host in the root
 * route renders it.
 */
export interface RaceDialogSeed {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** Branch the entrants start from; null means the project checkout's branch. */
  readonly baseBranch: string | null;
  /** Checkout whose uncommitted changes the race would not see. */
  readonly checkoutCwd: string | null;
  readonly sourceThreadId: ThreadId | null;
  readonly sourceModel: ModelSelection | null;
  /** Text to race; null means the source thread's last request. */
  readonly prompt: string | null;
  /** Set for a rematch: new entrants join this race on its prompt and base commit. */
  readonly rematch?: RaceRematchSeed;
}

export interface RaceRematchSeed {
  readonly raceId: string;
  readonly titleSeed: string;
  readonly startedAt: string;
  /** Highest slot the race has used; new entrants take the slots after it. */
  readonly existingCount: number;
  /** Slots still in the arena; they defend in the new heat. */
  readonly liveSlots: ReadonlyArray<number>;
  readonly baseCommit: string;
  readonly heat: number;
  readonly projectTitle: string;
}

export function openRematchDialog(seed: RaceDialogSeed & { readonly rematch: RaceRematchSeed }) {
  publish(seed);
}

let state: RaceDialogSeed | null = null;
const listeners = new Set<() => void>();

function publish(next: RaceDialogSeed | null): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Seed from a thread: its project, its branch and checkout, its model, and its last request. */
export function openRaceDialogForThread(
  thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly modelSelection: ModelSelection;
  },
  prompt: string | null = null,
): void {
  publish({
    environmentId: thread.environmentId,
    projectId: thread.projectId,
    baseBranch: thread.branch,
    checkoutCwd: thread.worktreePath,
    sourceThreadId: thread.id,
    sourceModel: thread.modelSelection,
    prompt: prompt?.trim() ? prompt : null,
  });
}

export function closeRaceDialog(): void {
  if (state !== null) publish(null);
}

export function readRaceDialogState(): RaceDialogSeed | null {
  return state;
}

export function subscribeRaceDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
