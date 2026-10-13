/* agent-watermark: model=haiku-5.5; effort=high; duration=35m; seat=claude-code; date=2026-10-12 */
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { normalizeSearchText } from "../lib/utils";
import { sortThreads, type ThreadSortInput } from "../lib/threadSort";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { getSidebarProjectFolder, sortScopedProjectsForSidebar } from "./Sidebar.logic";

/**
 * Pure model behind the no-active-thread launchpad. Every value it returns is
 * derived from the shell rows the client already holds; nothing is estimated.
 */

export const LAUNCHPAD_RECENT_THREAD_LIMIT = 8;

export type LaunchpadThreadTone = "working" | "attention" | "failed" | "idle";

export interface LaunchpadThreadState {
  readonly label: string;
  readonly tone: LaunchpadThreadTone;
}

export interface LaunchpadThreadInput extends ThreadSortInput {
  readonly id: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly branch: string | null;
  readonly archivedAt: string | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly session: {
    readonly status: string;
    readonly lastError?: string | null;
  } | null;
  readonly latestTurn: {
    readonly state: string;
  } | null;
}

export interface LaunchpadProjectInput {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LaunchpadRecentThread {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly projectTitle: string | null;
  readonly branch: string | null;
  readonly state: LaunchpadThreadState;
  readonly timestampLabel: string;
}

export interface LaunchpadProject {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly folder: string;
  readonly workspaceRoot: string;
  /** Non-archived threads in this project. */
  readonly threadCount: number;
  /** Threads in this project whose state needs attention or is working. */
  readonly liveThreadCount: number;
}

export interface LaunchpadModel {
  readonly recentThreads: ReadonlyArray<LaunchpadRecentThread>;
  readonly projects: ReadonlyArray<LaunchpadProject>;
  readonly activeThreadCount: number;
}

export function launchpadProjectKey(environmentId: string, projectId: string): string {
  return `${environmentId}:${projectId}`;
}

/**
 * The state a thread row names. Order matters: a pending decision outranks a
 * running turn, and a failed session outranks a settled one. A thread with no
 * session, no turn and no message is "Not started"; a thread with history but no
 * live session reads "Idle", never a guessed "Ready".
 */
export function resolveLaunchpadThreadState(thread: LaunchpadThreadInput): LaunchpadThreadState {
  if (thread.hasPendingApprovals) {
    return { label: "Needs approval", tone: "attention" };
  }
  if (thread.hasPendingUserInput) {
    return { label: "Needs input", tone: "attention" };
  }
  const sessionStatus = thread.session?.status;
  if (sessionStatus === "starting" || sessionStatus === "running") {
    return { label: "Working", tone: "working" };
  }
  if (sessionStatus === "error") {
    return { label: "Failed", tone: "failed" };
  }
  if (thread.latestTurn?.state === "error") {
    return { label: "Last turn failed", tone: "failed" };
  }
  if (thread.session === null && thread.latestTurn === null && !thread.latestUserMessageAt) {
    return { label: "Not started", tone: "idle" };
  }
  if (sessionStatus === "ready") {
    return { label: "Ready", tone: "idle" };
  }
  return { label: "Idle", tone: "idle" };
}

function isLiveTone(tone: LaunchpadThreadTone): boolean {
  return tone === "working" || tone === "attention";
}

export function buildLaunchpadModel(input: {
  readonly projects: ReadonlyArray<LaunchpadProjectInput>;
  readonly threads: ReadonlyArray<LaunchpadThreadInput>;
  readonly recentLimit?: number;
}): LaunchpadModel {
  const liveThreads = input.threads.filter((thread) => thread.archivedAt === null);
  const projectTitleByKey = new Map(
    input.projects.map(
      (project) => [launchpadProjectKey(project.environmentId, project.id), project.title] as const,
    ),
  );

  const threadStatesById = new Map(
    liveThreads.map((thread) => [
      launchpadProjectKey(thread.environmentId, thread.id),
      resolveLaunchpadThreadState(thread),
    ]),
  );

  const recentThreads = sortThreads(liveThreads, "updated_at")
    .slice(0, input.recentLimit ?? LAUNCHPAD_RECENT_THREAD_LIMIT)
    .map((thread): LaunchpadRecentThread => {
      const state = threadStatesById.get(launchpadProjectKey(thread.environmentId, thread.id)) ?? {
        label: "Ready",
        tone: "idle",
      };
      return {
        key: launchpadProjectKey(thread.environmentId, thread.id),
        environmentId: thread.environmentId,
        threadId: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        projectTitle:
          projectTitleByKey.get(launchpadProjectKey(thread.environmentId, thread.projectId)) ??
          null,
        branch: thread.branch,
        state,
        timestampLabel: formatRelativeTimeLabel(
          thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
        ),
      };
    });

  const sortedProjects = sortScopedProjectsForSidebar(input.projects, liveThreads, "updated_at");
  const projects = sortedProjects.map((project): LaunchpadProject => {
    const projectThreads = liveThreads.filter(
      (thread) => thread.environmentId === project.environmentId && thread.projectId === project.id,
    );
    return {
      key: launchpadProjectKey(project.environmentId, project.id),
      environmentId: project.environmentId,
      projectId: project.id,
      title: project.title,
      folder: getSidebarProjectFolder(project.workspaceRoot),
      workspaceRoot: project.workspaceRoot,
      threadCount: projectThreads.length,
      liveThreadCount: projectThreads.filter((thread) =>
        isLiveTone(
          threadStatesById.get(launchpadProjectKey(thread.environmentId, thread.id))?.tone ??
            "idle",
        ),
      ).length,
    };
  });

  return {
    recentThreads,
    projects,
    activeThreadCount: liveThreads.length,
  };
}

/** Case- and accent-insensitive project filter over title, folder and path. */
export function filterLaunchpadProjects(
  projects: ReadonlyArray<LaunchpadProject>,
  query: string,
): ReadonlyArray<LaunchpadProject> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return projects;
  const tokens = normalizedQuery.split(" ");
  return projects.filter((project) => {
    const haystack = normalizeSearchText(
      `${project.title} ${project.folder} ${project.workspaceRoot}`,
    );
    return tokens.every((token) => haystack.includes(token));
  });
}

/** Plain-language summary of the real counts, with the singular and plural both handled. */
export function describeLaunchpadCounts(model: LaunchpadModel): string {
  const threads = model.activeThreadCount;
  const projects = model.projects.length;
  const threadPart = `${threads} ${threads === 1 ? "thread" : "threads"}`;
  const projectPart = `${projects} ${projects === 1 ? "project" : "projects"}`;
  return `${threadPart} across ${projectPart}`;
}

export type LaunchpadPhase = "loading" | "no-projects" | "ready";

/**
 * Before the shell snapshot has bootstrapped, an empty project list means "not
 * loaded yet", not "none exist". Only a bootstrapped, empty list may be described
 * as having no projects.
 */
export function resolveLaunchpadPhase(input: {
  readonly bootstrapped: boolean;
  readonly projectCount: number;
}): LaunchpadPhase {
  if (!input.bootstrapped) {
    return "loading";
  }
  return input.projectCount > 0 ? "ready" : "no-projects";
}
