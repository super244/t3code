/* agent-watermark: model=haiku-5.5; effort=high; duration=42m; seat=claude-code; date=2026-10-13 */
import { MemoryPanel } from "../memory/MemoryPanel";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { resolveEnvironmentMachineKind, type ScopedProjectRef } from "@t3tools/contracts";
import { formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { mergeUsageProjects } from "@t3tools/shared/usageProjects";
import { Link } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  FolderGit2Icon,
  GitBranchIcon,
  GitPullRequestIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useClientSettings } from "../../hooks/useSettings";
import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { useUiStateStore } from "../../uiStateStore";
import {
  useProjects,
  useThreadShells,
  useAllEnvironmentShellsBootstrapped,
} from "../../state/entities";
import { useEnvironment, usePrimaryEnvironmentId, useEnvironments } from "../../state/environments";
import { useUsage } from "../../state/usage";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { selectProjectGroupingSettings } from "../../logicalProject";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatWorktreePathForDisplay } from "../../worktreeCleanup";
import type { SidebarThreadSummary } from "../../types";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { resolveSettledThreadTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { ThreadRowLeadingStatus, ThreadRowTrailingStatus } from "../ThreadStatusIndicators";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { buttonVariants } from "../ui/button";
import { SidebarTurnRecapLine } from "../sidebar/SidebarTurnRecapLine";
import { makeUsageWindow, usageWindowOption } from "../usage/usageWindows";
import { readUsagePagePreferences } from "../usage/usagePagePreferences";
import { projectSettingsTarget } from "./projectRoutes";
import { findProjectGroupForKey } from "./projectHomeMatch";
import {
  PROJECT_HOME_ROW_LIMIT,
  bucketProjectThreads,
  findProjectUsage,
  summarizeProjectPullRequests,
  summarizeProjectRecaps,
  summarizeProjectWorkspaces,
  type ProjectPullRequestEntry,
  type ProjectRecapEntry,
  type ProjectThreadBuckets,
  type ProjectWorkspaceUse,
} from "./projectHome.logic";

const threadKeyOf = (thread: SidebarThreadSummary) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

/**
 * One project's home: what it is, what its threads are doing, the branches and
 * worktrees and pull requests they use, what they recently finished, and what
 * they cost. Every figure comes from the same state the sidebar reads.
 */
export function ProjectHomePage({ projectKey }: { readonly projectKey: string }) {
  const projects = useProjects();
  const threads = useThreadShells();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const { environments } = useEnvironments();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const handleNewThread = useNewThreadHandler();

  const groups = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) =>
          environments.find((environment) => environment.environmentId === environmentId)?.label ??
          null,
      }),
    [environments, primaryEnvironmentId, projectGroupingSettings, projects],
  );
  const group = useMemo(() => findProjectGroupForKey(groups, projectKey), [groups, projectKey]);

  if (group === null) {
    return (
      <ProjectHomeFrame name={bootstrapped ? "Project not found" : "Loading project"}>
        <p className="text-sm text-muted-foreground">
          {bootstrapped
            ? "No project in any connected environment matches this link. It may have been removed, or the environment that holds it is offline."
            : "Reading projects from your environments."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className={buttonVariants({ size: "compact", variant: "outline" })} to="/home">
            Launchpad
          </Link>
          <Link
            className={buttonVariants({ size: "compact", variant: "outline" })}
            to="/settings/projects"
            search={{ project: undefined, machine: undefined }}
          >
            All projects
          </Link>
        </div>
      </ProjectHomeFrame>
    );
  }

  return (
    <LoadedProjectHome
      group={group}
      threads={threads}
      lastVisitedAtById={lastVisitedAtById}
      onNewThread={(ref) => void handleNewThread(ref)}
    />
  );
}

function LoadedProjectHome({
  group,
  threads,
  lastVisitedAtById,
  onNewThread,
}: {
  readonly group: SidebarProjectSnapshot;
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly lastVisitedAtById: Readonly<Record<string, string>>;
  readonly onNewThread: (ref: ScopedProjectRef) => void;
}) {
  const memberKeys = useMemo(
    () => new Set(group.memberProjects.map((member) => `${member.environmentId}:${member.id}`)),
    [group.memberProjects],
  );
  const projectThreads = useMemo(
    () => threads.filter((thread) => memberKeys.has(`${thread.environmentId}:${thread.projectId}`)),
    [memberKeys, threads],
  );
  // Snooze and wake are time-based; a fresh clock per visit is enough for a home page.
  const now = useMemo(() => new Date().toISOString(), [projectThreads]);
  const buckets = useMemo<ProjectThreadBuckets>(
    () =>
      bucketProjectThreads(projectThreads, {
        now,
        lastVisitedAtByKey: lastVisitedAtById,
        threadKeyOf,
      }),
    [lastVisitedAtById, now, projectThreads],
  );
  const workspaces = useMemo(() => summarizeProjectWorkspaces(projectThreads), [projectThreads]);
  const pullRequests = useMemo(
    () => summarizeProjectPullRequests(projectThreads),
    [projectThreads],
  );
  const recaps = useMemo(() => summarizeProjectRecaps(buckets.settled), [buckets.settled]);
  const environment = useEnvironment(group.environmentId);
  const machine = resolveEnvironmentMachineKind(environment?.serverConfig ?? null);
  const [usageWindowPreset] = useState(() => readUsagePagePreferences().windowPreset);
  const usageWindow = useMemo(() => makeUsageWindow(usageWindowPreset), [usageWindowPreset]);
  const usage = useUsage(usageWindow);
  const usageLabel = usageWindowOption(usageWindowPreset).label;
  const answeredUsage = usage.environments.flatMap((status) =>
    status.summary === null
      ? []
      : [{ environmentId: status.environmentId, summary: status.summary }],
  );
  const usageSummary = useMemo(() => mergeUsageProjects(answeredUsage), [answeredUsage]);
  const projectUsage = findProjectUsage(usageSummary, group.workspaceRoot);
  const groupRef = scopeProjectRef(group.environmentId, group.id);

  const counts = {
    running: buckets.running.length,
    needsYou: buckets.needsYou.length,
    open: buckets.open.length,
    settled: buckets.settled.length,
    archived: buckets.archived.length,
  };
  const environmentLine = [
    environment?.label ?? "This environment",
    ...group.remoteEnvironmentLabels.filter((label) => label !== environment?.label),
  ].join(" · ");

  return (
    <ProjectHomeFrame
      name={group.displayName}
      headerLead={<ProjectFavicon project={group} className="size-4 shrink-0" />}
    >
      <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-1 flex shrink-0">
            <ProjectFavicon project={group} className="size-6" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-xl font-semibold text-foreground sm:text-2xl">
              {group.displayName}
            </h1>
            <Tooltip>
              <TooltipTrigger
                render={<p className="truncate font-mono text-xs text-muted-foreground/80" />}
              >
                {group.workspaceRoot}
              </TooltipTrigger>
              <TooltipPopup>{group.workspaceRoot}</TooltipPopup>
            </Tooltip>
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground/80">
              <EnvironmentMachineIcon kind={machine} className="size-3.5 shrink-0" />
              <span className="truncate">{environmentLine}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonVariants({ size: "compact" })}
            onClick={() => onNewThread(groupRef)}
          >
            <PlusIcon className="size-3.5" />
            New thread
          </button>
          <Link
            className={buttonVariants({ size: "compact", variant: "outline" })}
            {...projectSettingsTarget(group.projectKey)}
          >
            <SettingsIcon className="size-3.5" />
            Project settings
          </Link>
        </div>
      </header>

      <dl className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Thread counts">
        <CountTile label="Running" value={counts.running} tone="sky" />
        <CountTile label="Needs you" value={counts.needsYou} tone="indigo" />
        <CountTile label="Open" value={counts.open} />
        <CountTile label="Settled" value={counts.settled} />
        <CountTile label="Archived" value={counts.archived} />
      </dl>

      <div className="mt-6 grid items-start gap-4 md:grid-cols-2">
        <ThreadSection
          id="project-running"
          title="Running"
          count={counts.running}
          threads={buckets.running}
          empty="Nothing is running in this project."
          hint="A live session or background work, the same Working state the sidebar shows."
        />
        <ThreadSection
          id="project-needs-you"
          title="Needs you"
          count={counts.needsYou}
          threads={buckets.needsYou}
          empty="Nothing is waiting on you."
          hint="Approvals, questions, proposed plans and finishes you have not looked at."
        />
        <ThreadSection
          id="project-open"
          title="Open"
          count={counts.open}
          threads={buckets.open}
          empty="No open threads. Start one with New thread above."
          hint="Threads that are resting, pinned or snoozed."
        />
        <ThreadSection
          id="project-settled"
          title="Settled"
          count={counts.settled}
          threads={buckets.settled}
          empty="No settled threads yet. Threads you finish move here."
          hint="Newest first, by when the work ended."
          settled
        />
        <ThreadSection
          id="project-archived"
          title="Archived"
          count={counts.archived}
          threads={buckets.archived}
          empty="No archived threads."
          hint="Archived threads stay here until you restore them."
        />
        <MemorySection members={group.memberProjects} />
        <WorkspaceSection workspaces={workspaces} />
        <PullRequestSection pullRequests={pullRequests} threads={projectThreads} />
        <RecapSection recaps={recaps} />
        <UsageSection
          usageLabel={usageLabel}
          row={projectUsage}
          summaryPartial={usageSummary.partial}
          isPending={usage.isPending}
          answeredCount={answeredUsage.length}
          summaryTotal={usageSummary.projects.length}
        />
      </div>
    </ProjectHomeFrame>
  );
}

function ProjectHomeFrame({
  name,
  headerLead,
  children,
}: {
  readonly name: string;
  readonly headerLead?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
            <Link
              to="/settings/projects"
              search={{ project: undefined, machine: undefined }}
              className="shrink-0 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              Projects
            </Link>
            <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" />
            <span
              className="flex min-w-0 items-center gap-1.5 font-medium text-foreground"
              aria-current="page"
            >
              {headerLead}
              <span className="truncate">{name}</span>
            </span>
          </nav>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-10">{children}</div>
        </div>
      </div>
    </SidebarInset>
  );
}

const TONE_TEXT: Record<"sky" | "indigo", string> = {
  sky: "text-sky-600 dark:text-sky-300/80",
  indigo: "text-indigo-600 dark:text-indigo-300/90",
};

function CountTile({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: "sky" | "indigo";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border/70 px-3 py-2.5">
      <dt className="truncate text-xs text-muted-foreground/80">{label}</dt>
      <dd
        className={cn(
          "text-lg font-semibold tabular-nums text-foreground",
          value > 0 && tone ? TONE_TEXT[tone] : null,
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function SectionCard({
  id,
  title,
  count,
  hint,
  className,
  children,
}: {
  readonly id: string;
  readonly className?: string;
  readonly title: string;
  readonly count?: number;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      id={id}
      className={cn("min-w-0 rounded-lg border border-border/70 p-4", className)}
    >
      <div className="mb-2 flex min-w-0 items-baseline justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-sm font-medium text-foreground">
          {title}
        </h2>
        {count !== undefined ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
        ) : null}
      </div>
      {hint ? <p className="mb-3 text-xs text-muted-foreground/75">{hint}</p> : null}
      {children}
    </section>
  );
}

function EmptyNote({ children }: { readonly children: ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground/80">{children}</p>;
}

function ThreadSection({
  id,
  title,
  count,
  threads,
  empty,
  hint,
  settled = false,
}: {
  readonly id: string;
  readonly title: string;
  readonly count: number;
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly empty: string;
  readonly hint: string;
  readonly settled?: boolean;
}) {
  const shown = threads.slice(0, PROJECT_HOME_ROW_LIMIT);
  const hidden = threads.length - shown.length;
  return (
    <SectionCard id={id} title={title} count={count} hint={hint}>
      {shown.length === 0 ? (
        <EmptyNote>{empty}</EmptyNote>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {shown.map((thread) => (
            <ProjectThreadRow key={threadKeyOf(thread)} thread={thread} settled={settled} />
          ))}
          {hidden > 0 ? (
            <li className="px-2 pt-1 text-xs text-muted-foreground/75">
              {hidden} more in this section. The sidebar lists them all.
            </li>
          ) : null}
        </ul>
      )}
    </SectionCard>
  );
}

function ProjectThreadRow({
  thread,
  settled = false,
}: {
  readonly thread: SidebarThreadSummary;
  /** Settled rows read "how long ago it wrapped up", the same as the sidebar's settled shelf. */
  readonly settled?: boolean;
}) {
  const timestamp = settled
    ? resolveSettledThreadTimestamp(thread)
    : (thread.latestUserMessageAt ?? thread.updatedAt);
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40">
      <Link
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id))}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate text-sm font-medium text-foreground">{thread.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground/75">
          {thread.branch ? (
            <>
              <span className="min-w-0 truncate font-mono">{thread.branch}</span>
              <span aria-hidden className="shrink-0 text-muted-foreground/50">
                ·
              </span>
            </>
          ) : null}
          {timestamp ? (
            <span className="shrink-0 tabular-nums">{formatRelativeTimeLabel(timestamp)}</span>
          ) : null}
        </span>
      </Link>
      <ThreadRowLeadingStatus thread={thread} />
      <ThreadRowTrailingStatus thread={thread} />
    </li>
  );
}

function WorkspaceSection({
  workspaces,
}: {
  readonly workspaces: ReadonlyArray<ProjectWorkspaceUse>;
}) {
  const shown = workspaces.slice(0, PROJECT_HOME_ROW_LIMIT);
  return (
    <SectionCard
      id="project-workspaces"
      title="Branches and worktrees"
      count={workspaces.length}
      hint="Where your live threads are working right now."
    >
      {shown.length === 0 ? (
        <EmptyNote>
          No live thread is on a branch or worktree. Threads record one once they start working.
        </EmptyNote>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((use) => (
            <li key={use.key} className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5">
              {use.worktreePath ? (
                <FolderGit2Icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-icon-muted" />
              ) : (
                <GitBranchIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-icon-muted" />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-mono text-sm text-foreground">
                  {use.branch ?? "Detached HEAD"}
                </span>
                {use.worktreePath ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="truncate text-xs text-muted-foreground/75" />}
                    >
                      {formatWorktreePathForDisplay(use.worktreePath)}
                    </TooltipTrigger>
                    <TooltipPopup>{use.worktreePath}</TooltipPopup>
                  </Tooltip>
                ) : null}
                <span className="truncate text-xs text-muted-foreground/75">
                  {use.threads.length === 1 ? "1 thread" : `${use.threads.length} threads`}:{" "}
                  {use.threads.map((thread) => thread.title).join(", ")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

const PR_STATE_LABEL: Record<"open" | "closed" | "merged", string> = {
  open: "Open",
  closed: "Closed",
  merged: "Merged",
};

function PullRequestSection({
  pullRequests,
  threads,
}: {
  readonly pullRequests: ReadonlyArray<ProjectPullRequestEntry>;
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
}) {
  const shown = pullRequests.slice(0, PROJECT_HOME_ROW_LIMIT);
  const linkedCount = threads.filter((thread) => thread.pullRequests.length > 0).length;
  return (
    <SectionCard
      id="project-pull-requests"
      title="Pull requests"
      count={pullRequests.length}
      hint="Pull requests linked to this project's threads."
    >
      {shown.length === 0 ? (
        <EmptyNote>
          {linkedCount === 0
            ? "No pull request is linked to a thread here. Link one from a thread to see it here."
            : "The linked pull requests are removed from the list. Nothing is open here."}
        </EmptyNote>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((pr) => (
            <li key={pr.key} className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5">
              <GitPullRequestIcon
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-icon-muted"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  #{pr.number} {pr.title ?? pr.repository}
                </a>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground/75">
                  <span className="shrink-0">
                    {pr.state === null
                      ? "Not synced yet"
                      : `${PR_STATE_LABEL[pr.state]}${pr.isDraft ? " draft" : ""}`}
                  </span>
                  <span aria-hidden className="shrink-0 text-muted-foreground/50">
                    ·
                  </span>
                  <span className="min-w-0 truncate">{pr.threadTitle}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function MemorySection({
  members,
}: {
  readonly members: SidebarProjectSnapshot["memberProjects"];
}) {
  return (
    <SectionCard
      id="project-memory"
      title="Memory"
      hint="What every new agent session in this project starts with, whatever the provider. Agents add to it with their remember tool."
      className="lg:col-span-2"
    >
      <div className="flex min-w-0 flex-col gap-6">
        {members.map((member) => (
          <div key={`${member.environmentId}:${member.id}`} className="min-w-0">
            {members.length > 1 ? (
              <p className="mb-2 text-xs text-muted-foreground">{member.environmentId}</p>
            ) : null}
            <MemoryPanel
              environmentId={member.environmentId}
              projectId={member.id}
              projects={[{ id: member.id, title: member.title }]}
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function RecapSection({ recaps }: { readonly recaps: ReadonlyArray<ProjectRecapEntry> }) {
  return (
    <SectionCard
      id="project-recaps"
      title="Recent recaps"
      count={recaps.length}
      hint="What the latest settled threads did in their last turn."
    >
      {recaps.length === 0 ? (
        <EmptyNote>
          No settled thread has a recap yet. A recap appears when a settled thread finishes a turn
          with recorded changes or commands.
        </EmptyNote>
      ) : (
        <ul className="flex flex-col gap-2">
          {recaps.map((entry) => (
            <li
              key={`${entry.environmentId}:${entry.threadId}`}
              className="min-w-0 rounded-md px-2 py-1.5 hover:bg-accent/40"
            >
              <Link
                to="/$environmentId/$threadId"
                params={buildThreadRouteParams(scopeThreadRef(entry.environmentId, entry.threadId))}
                className="flex min-w-0 flex-col gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate text-sm font-medium text-foreground">{entry.title}</span>
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <SidebarTurnRecapLine recap={entry.recap} />
                  {entry.settledAt ? (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground/75">
                      {formatRelativeTimeLabel(entry.settledAt)}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function UsageSection({
  usageLabel,
  row,
  summaryPartial,
  isPending,
  answeredCount,
  summaryTotal,
}: {
  readonly usageLabel: string;
  readonly row: ReturnType<typeof findProjectUsage>;
  readonly summaryPartial: boolean;
  readonly isPending: boolean;
  readonly answeredCount: number;
  readonly summaryTotal: number;
}) {
  let body: ReactNode;
  if (row !== null) {
    body = (
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <UsageStat label="Cost" value={formatUsd(row.costUsd)} />
        <UsageStat label="Share" value={formatPercent(row.costShare)} />
        <UsageStat label="Tokens" value={formatTokens(row.totalTokens)} />
        <UsageStat label="Sessions" value={String(row.sessions)} />
      </dl>
    );
  } else if (isPending && answeredCount === 0) {
    body = (
      <EmptyNote>
        Reading usage from your environments. Scanning every transcript can take a minute.
      </EmptyNote>
    );
  } else if (summaryTotal === 0 && answeredCount > 0) {
    body = (
      <EmptyNote>
        No usage is recorded by project in the last {usageLabel}. Only Claude Code records the
        project it ran in.
      </EmptyNote>
    );
  } else {
    body = <EmptyNote>No usage is recorded for this project in the last {usageLabel}.</EmptyNote>;
  }
  return (
    <SectionCard
      id="project-usage"
      className="md:col-span-2"
      title="Usage"
      hint={`Cost and tokens for this project, last ${usageLabel}.`}
    >
      {body}
      {summaryPartial ? (
        <p className="mt-3 text-xs text-muted-foreground/75">
          An environment predates usage by project. Update it to include its usage here.
        </p>
      ) : null}
      <Link
        to="/usage"
        className="mt-3 inline-flex text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        Open full usage
      </Link>
    </SectionCard>
  );
}

function UsageStat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border/60 px-2.5 py-2">
      <dt className="text-xs text-muted-foreground/80">{label}</dt>
      <dd className="truncate text-sm font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
