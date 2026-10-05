/* agent-watermark: model=opus-5.5; effort=high; duration=40m; seat=claude-code; date=2026-10-05 */
import type { ScopedThreadRef } from "@t3tools/contracts";

/**
 * One handoff dialog for the whole app. The sidebar row menu, the chat header
 * menu, the command palette and the failed-turn banner all open it here; the
 * host in the root route renders it.
 */
export type HandoffDialogMode = "handoff" | "review";

export interface HandoffDialogState {
  readonly threadRef: ScopedThreadRef | null;
  /** handoff continues the work elsewhere; review asks another agent to check it. */
  readonly mode: HandoffDialogMode;
  /** Why the user is handing off, shown in the dialog (e.g. the provider's error). */
  readonly reason: string | null;
}

const closed: HandoffDialogState = { threadRef: null, mode: "handoff", reason: null };
let state: HandoffDialogState = closed;
const listeners = new Set<() => void>();

function publish(next: HandoffDialogState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function openHandoffDialog(
  threadRef: ScopedThreadRef,
  options?: { reason?: string | null; mode?: HandoffDialogMode },
) {
  publish({ threadRef, mode: options?.mode ?? "handoff", reason: options?.reason?.trim() || null });
}

export function openReviewDialog(threadRef: ScopedThreadRef) {
  openHandoffDialog(threadRef, { mode: "review" });
}

export function closeHandoffDialog(): void {
  if (state.threadRef !== null) publish(closed);
}

export function readHandoffDialogState(): HandoffDialogState {
  return state;
}

export function subscribeHandoffDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
