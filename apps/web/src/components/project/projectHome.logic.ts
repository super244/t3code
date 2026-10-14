/* agent-watermark: model=haiku-5.5; effort=high; duration=40m; seat=claude-code; date=2026-10-13 */
import type { EnvironmentId, ThreadId, ThreadPullRequestLink } from "@t3tools/contracts";
import type { ProjectUsage, ProjectUsageSummary } from "@t3tools/shared/usageProjects";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";

import {
  resolveThreadStatusPill,
  sortSettledThreadsForSidebar,
  sortThreadsForSidebar,
} from "../Sidebar.logic";
import { summarizeSidebarTurnRecap, type SidebarTurnRecap } from "../../lib/turnRecap";
import type { SidebarThreadSummary } from "../../types";

/** How many rows each section shows before the "all" link takes over. */
export const PROJECT_HOME_ROW_LIMIT = 4;

export type ProjectThreadBucket = "running" | "needs-you" | "open" | "settled" | "archived";

export interface ProjectThreadBuckets {
  readonly running: ReadonlyArray<SidebarThreadSummary>;
  readonly needsYou: ReadonlyArray<SidebarThreadSummary>;
  readonly open: ReadonlyArray<SidebarThreadSummary>;
  readonly settled: ReadonlyArray<SidebarThreadSummary>;
  readonly archived: ReadonlyArray<SidebarThreadSummary>;
}

// Status labels come from the sidebar's own pill rules, so a thread reads the
// same here as on its sidebar row. "Completed" is an unseen finish: the agent
// stopped and nobody has looked yet, which is a thing the user owes a glance.
const RUNNING_PILL_LABELS: ReadonlySet<string> = new Set(["Working", "Connecting", "Monitoring"]);
const NEEDS_YOU_PILL_LABELS: ReadonlySet<string> = new Set([
  "Pending Approval",
  "Awaiting Input",
  "Plan Ready",
  "Completed",
]);

/**
 * Splits one project's non-archived and archived threads the way the sidebar
 * does. Precedence follows the sidebar's section rules: archived first, then
 * snoozed (kept in open here, since the project home has no snooze shelf),
 * then settled, then the live status of whatever is left.
 */
export function bucketProjectThreads(
  threads: ReadonlyArray<SidebarThreadSummary>,
  input: {
    readonly now: string;
    readonly lastVisitedAtByKey: Readonly<Record<string, string | undefined>>;
    readonly threadKeyOf: (thread: SidebarThreadSummary) => string;
  },
): ProjectThreadBuckets {
  const running: SidebarThreadSummary[] = [];
  const needsYou: SidebarThreadSummary[] = [];
  const open: SidebarThreadSummary[] = [];
  const settled: SidebarThreadSummary[] = [];
  const archived: SidebarThreadSummary[] = [];
  for (const thread of threads) {
    if (thread.archivedAt !== null) {
      archived.push(thread);
      continue;
    }
    if (effectiveSnoozed(thread, { now: input.now })) {
      open.push(thread);
      continue;
    }
    if (thread.settledOverride === "settled") {
      settled.push(thread);
      continue;
    }
    const lastVisitedAt = input.lastVisitedAtByKey[input.threadKeyOf(thread)];
    const pill = resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt } });
    if (pill !== null && RUNNING_PILL_LABELS.has(pill.label)) {
      running.push(thread);
    } else if (pill !== null && NEEDS_YOU_PILL_LABELS.has(pill.label)) {
      needsYou.push(thread);
    } else {
      open.push(thread);
    }
  }
  return {
    running: sortThreadsForSidebar(running),
    needsYou: sortThreadsForSidebar(needsYou),
    open: sortThreadsForSidebar(open),
    settled: sortSettledThreadsForSidebar(settled),
    archived: [...archived].toSorted((left, right) =>
      (right.archivedAt ?? "").localeCompare(left.archivedAt ?? ""),
    ),
  };
}

export interface ProjectWorkspaceUse {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly threads: ReadonlyArray<{ readonly id: ThreadId; readonly title: string }>;
  readonly latestActivityAt: string;
}

/**
 * Branches and worktrees that non-archived threads are on right now. A thread
 * with neither (a fresh draft on the default checkout) contributes nothing.
 */
export function summarizeProjectWorkspaces(
  threads: ReadonlyArray<SidebarThreadSummary>,
): ReadonlyArray<ProjectWorkspaceUse> {
  const byKey = new Map<string, ProjectWorkspaceUse>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    if (thread.branch === null && thread.worktreePath === null) continue;
    const key = `${thread.environmentId}\u0000${thread.worktreePath ?? ""}\u0000${thread.branch ?? ""}`;
    const activity = thread.latestUserMessageAt ?? thread.updatedAt;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        threads: [...existing.threads, { id: thread.id, title: thread.title }],
        latestActivityAt:
          activity > existing.latestActivityAt ? activity : existing.latestActivityAt,
      });
    } else {
      byKey.set(key, {
        key,
        environmentId: thread.environmentId,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        threads: [{ id: thread.id, title: thread.title }],
        latestActivityAt: activity,
      });
    }
  }
  return [...byKey.values()].toSorted((left, right) =>
    right.latestActivityAt.localeCompare(left.latestActivityAt),
  );
}

export interface ProjectPullRequestEntry {
  readonly key: string;
  readonly number: number;
  readonly repository: string;
  readonly url: string;
  /** Null until the host has synced the pull request at least once. */
  readonly state: "open" | "closed" | "merged" | null;
  readonly isDraft: boolean;
  readonly title: string | null;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly environmentId: EnvironmentId;
}

/**
 * Pull requests linked to this project's live threads, deduplicated by host,
 * repository and number so one PR linked from two threads shows once. Open
 * work comes first; unsynced links sort after the synced ones.
 */
export function summarizeProjectPullRequests(
  threads: ReadonlyArray<SidebarThreadSummary>,
): ReadonlyArray<ProjectPullRequestEntry> {
  const byKey = new Map<
    string,
    { readonly entry: ProjectPullRequestEntry; readonly linkedAt: string }
  >();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const links: ReadonlyArray<ThreadPullRequestLink> = visibleThreadPullRequests(
      thread.pullRequests,
    );
    for (const link of links) {
      const key = `${link.host}\u0000${link.repository}\u0000${link.number}`;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        linkedAt: link.linkedAt,
        entry: {
          key,
          number: link.number,
          repository: link.repository,
          url: link.url,
          state: link.snapshot?.state ?? null,
          isDraft: link.snapshot?.isDraft ?? false,
          title: link.snapshot?.title ?? null,
          threadId: thread.id,
          threadTitle: thread.title,
          environmentId: thread.environmentId,
        },
      });
    }
  }
  const rank = (state: ProjectPullRequestEntry["state"]) =>
    state === "open" ? 0 : state === null ? 2 : 1;
  return [...byKey.values()]
    .toSorted(
      (left, right) =>
        rank(left.entry.state) - rank(right.entry.state) ||
        right.linkedAt.localeCompare(left.linkedAt) ||
        left.entry.key.localeCompare(right.entry.key),
    )
    .map((value) => value.entry);
}

export interface ProjectRecapEntry {
  readonly threadId: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly settledAt: string | null;
  readonly recap: SidebarTurnRecap;
}

/**
 * Recaps of the most recently settled threads that recorded one. Settled
 * threads without a recap are skipped rather than shown as empty cards.
 */
export function summarizeProjectRecaps(
  settledThreads: ReadonlyArray<SidebarThreadSummary>,
  limit: number = PROJECT_HOME_ROW_LIMIT,
): ReadonlyArray<ProjectRecapEntry> {
  const entries: ProjectRecapEntry[] = [];
  for (const thread of settledThreads) {
    const recap = summarizeSidebarTurnRecap({
      recap: thread.latestTurnRecap,
      latestTurn: thread.latestTurn,
    });
    if (recap === null) continue;
    entries.push({
      threadId: thread.id,
      environmentId: thread.environmentId,
      title: thread.title,
      settledAt: thread.settledAt,
      recap,
    });
    if (entries.length >= limit) break;
  }
  return entries;
}

function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * This project's row in the usage summary. Usage is keyed by the transcript's
 * recorded project path, so the match is on the normalized workspace root.
 * Rows with no recorded path never match: they are not this project's usage.
 */
export function findProjectUsage(
  summary: ProjectUsageSummary,
  workspaceRoot: string,
): ProjectUsage | null {
  const target = normalizePath(workspaceRoot);
  return (
    summary.projects.find(
      (row) => row.projectPath !== null && normalizePath(row.projectPath) === target,
    ) ?? null
  );
}
