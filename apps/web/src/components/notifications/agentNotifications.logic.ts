/**
 * When a thread changes in a way the user should hear about while T3 Code is
 * in the background: a turn finished, an approval or an answer is needed, or
 * the turn failed. Pure — the component feeds it the thread shells the sidebar
 * already streams, so notifications add no websocket traffic.
 */

export type AgentAttention = "working" | "approval" | "input" | "failed" | "idle";
export type AgentEventKind = "finished" | "approval" | "input" | "failed";

export interface AgentShellLike {
  readonly key: string;
  readonly title: string;
  readonly archivedAt: string | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly session: { readonly status: string; readonly lastError?: string | null } | null;
  readonly latestTurn: { readonly turnId: string; readonly state: string } | null;
}

export interface AgentNotificationPrefs {
  readonly enabled: boolean;
  readonly finished: boolean;
  readonly approval: boolean;
  readonly input: boolean;
  readonly failed: boolean;
  /** Only notify while the window is in the background (the usual case). */
  readonly onlyWhenAway: boolean;
}

export const DEFAULT_AGENT_NOTIFICATION_PREFS: AgentNotificationPrefs = {
  enabled: false,
  finished: true,
  approval: true,
  input: true,
  failed: true,
  onlyWhenAway: true,
};

export interface AgentSnapshot {
  readonly attention: AgentAttention;
  readonly turnId: string | null;
}

export interface AgentEvent {
  readonly key: string;
  readonly kind: AgentEventKind;
  readonly title: string;
  readonly detail: string | null;
}

export function agentAttention(shell: AgentShellLike): AgentAttention {
  if (shell.hasPendingApprovals) return "approval";
  if (shell.hasPendingUserInput) return "input";
  const status = shell.session?.status;
  if (status === "running" || status === "starting") return "working";
  if (status === "error" || shell.latestTurn?.state === "error") return "failed";
  if (shell.latestTurn?.state === "running") return "working";
  return "idle";
}

/**
 * Compare two observations of the same threads. The first observation of a
 * thread never notifies — opening the app must not replay old state.
 */
export function diffAgentShells(
  previous: ReadonlyMap<string, AgentSnapshot>,
  shells: ReadonlyArray<AgentShellLike>,
): { readonly next: Map<string, AgentSnapshot>; readonly events: AgentEvent[] } {
  const next = new Map<string, AgentSnapshot>();
  const events: AgentEvent[] = [];
  for (const shell of shells) {
    if (shell.archivedAt !== null) continue;
    const snapshot: AgentSnapshot = {
      attention: agentAttention(shell),
      turnId: shell.latestTurn?.turnId ?? null,
    };
    next.set(shell.key, snapshot);
    const before = previous.get(shell.key);
    if (!before || before.attention === snapshot.attention) continue;
    const base = { key: shell.key, title: shell.title };
    switch (snapshot.attention) {
      case "approval":
        events.push({ ...base, kind: "approval", detail: null });
        break;
      case "input":
        events.push({ ...base, kind: "input", detail: null });
        break;
      case "failed":
        events.push({ ...base, kind: "failed", detail: shell.session?.lastError ?? null });
        break;
      case "idle":
        if (before.attention === "working" && shell.latestTurn?.state === "completed") {
          events.push({ ...base, kind: "finished", detail: null });
        }
        break;
      default:
        break;
    }
  }
  return { next, events };
}

export function shouldNotify(event: AgentEvent, prefs: AgentNotificationPrefs): boolean {
  return prefs.enabled && prefs[event.kind];
}

const HEADLINE: Record<AgentEventKind, string> = {
  finished: "Finished",
  approval: "Needs your approval",
  input: "Needs your answer",
  failed: "Failed",
};

export function notificationText(
  event: AgentEvent,
  projectTitle: string | null,
): { title: string; body: string } {
  const where = projectTitle ? ` · ${projectTitle}` : "";
  const detail = event.detail ? `\n${event.detail.slice(0, 160)}` : "";
  return { title: `${HEADLINE[event.kind]}${where}`, body: `${event.title}${detail}` };
}
