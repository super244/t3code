/* agent-watermark: model=haiku-5.5; effort=high; duration=27m; seat=claude-code; date=2026-10-12 */
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Link } from "@tanstack/react-router";
import { FolderIcon, MessageSquareIcon, PlusIcon, SearchIcon } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { isElectron } from "../env";
import { buildThreadRouteParams } from "../threadRoutes";
import { useProjects, useThreadShells } from "../state/entities";
import { cn } from "~/lib/utils";
import {
  buildLaunchpadModel,
  describeLaunchpadCounts,
  filterLaunchpadProjects,
  type LaunchpadProject,
  type LaunchpadRecentThread,
  type LaunchpadThreadTone,
} from "./NoActiveThreadState.logic";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SidebarInset } from "./ui/sidebar";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

/** Above this many projects the quick-start list gets a filter field. */
const PROJECT_FILTER_THRESHOLD = 5;

const TONE_TEXT_CLASS: Record<LaunchpadThreadTone, string> = {
  working: "text-sky-600 dark:text-sky-300/80",
  attention: "text-amber-600 dark:text-amber-300/90",
  failed: "text-red-600 dark:text-red-300/90",
  idle: "text-muted-foreground/70",
};

const TONE_DOT_CLASS: Record<LaunchpadThreadTone, string> = {
  working: "bg-sky-500 dark:bg-sky-300/80",
  attention: "bg-amber-500 dark:bg-amber-300/90",
  failed: "bg-red-500 dark:bg-red-300/90",
  idle: "bg-muted-foreground/40",
};

/**
 * The calm screen shown when no thread is open: where you left off across every
 * project, what each project holds, and a quick start into a chosen project.
 */
export function NoActiveThreadState() {
  const projects = useProjects();
  const threads = useThreadShells();
  const openNewThread = useNewThreadHandler();
  const [projectFilter, setProjectFilter] = useState("");
  const [startingProjectKey, setStartingProjectKey] = useState<string | null>(null);

  const model = useMemo(() => buildLaunchpadModel({ projects, threads }), [projects, threads]);
  const visibleProjects = useMemo(
    () => filterLaunchpadProjects(model.projects, projectFilter),
    [model.projects, projectFilter],
  );

  const startThread = useCallback(
    (project: LaunchpadProject) => {
      setStartingProjectKey(project.key);
      void openNewThread(scopeProjectRef(project.environmentId, project.projectId))
        .catch((cause: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Couldn't start a thread",
              description: cause instanceof Error ? cause.message : String(cause),
            }),
          );
        })
        .finally(() => setStartingProjectKey(null));
    },
    [openNewThread],
  );

  const hasProjects = model.projects.length > 0;
  const hasThreads = model.recentThreads.length > 0;
  const headline = !hasProjects
    ? "Add a project to start"
    : hasThreads
      ? "Pick up a thread or start a new one"
      : "Start your first thread";
  const subline = hasProjects
    ? `${describeLaunchpadCounts(model)}.`
    : "No projects yet. Add a folder, and its threads will show up here.";

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
            Launchpad
          </span>
        </WorkspacePageHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
            <header className="mb-8">
              <h1 className="text-xl font-semibold text-foreground sm:text-2xl">{headline}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground/80">{subline}</p>
            </header>

            <div className="grid gap-8 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <section aria-labelledby="launchpad-recent-heading" className="min-w-0">
                <h2
                  id="launchpad-recent-heading"
                  className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70"
                >
                  Recent threads
                </h2>
                {hasThreads ? (
                  <ul className="flex flex-col gap-1">
                    {model.recentThreads.map((thread) => (
                      <li key={thread.key}>
                        <RecentThreadLink thread={thread} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyNote>
                    {hasProjects
                      ? "No threads yet. Start one from a project on the right."
                      : "No threads yet. Threads appear here once a project exists."}
                  </EmptyNote>
                )}
              </section>

              <section aria-labelledby="launchpad-projects-heading" className="min-w-0">
                <h2
                  id="launchpad-projects-heading"
                  className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70"
                >
                  Projects
                </h2>

                {hasProjects ? (
                  <>
                    {model.projects.length > PROJECT_FILTER_THRESHOLD ? (
                      <div className="relative mb-2">
                        <SearchIcon
                          aria-hidden
                          className="pointer-events-none absolute inset-s-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
                        />
                        <Input
                          type="search"
                          size="sm"
                          aria-label="Filter projects"
                          placeholder="Filter projects"
                          value={projectFilter}
                          onChange={(event) => setProjectFilter(event.target.value)}
                          className="ps-8"
                        />
                      </div>
                    ) : null}
                    {visibleProjects.length === 0 ? (
                      <EmptyNote>No project matches “{projectFilter.trim()}”.</EmptyNote>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {visibleProjects.map((project) => (
                          <li key={project.key}>
                            <ProjectStartRow
                              project={project}
                              isStarting={startingProjectKey === project.key}
                              onStart={startThread}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-start gap-3">
                    <EmptyNote>Add a folder as a project to start a thread in it.</EmptyNote>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openCommandPalette({ open: "add-project" })}
                    >
                      <PlusIcon className="size-4" />
                      Add project
                    </Button>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

function EmptyNote(props: { readonly children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground/80">
      {props.children}
    </p>
  );
}

function RecentThreadLink(props: { readonly thread: LaunchpadRecentThread }) {
  const { thread } = props;
  const context = [thread.projectTitle, thread.branch ? `#${thread.branch}` : null]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" · ");
  return (
    <Link
      to="/$environmentId/$threadId"
      params={buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.threadId))}
      className="flex min-w-0 items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:border-border hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MessageSquareIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-icon-muted" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">{thread.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground/75">
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1",
              TONE_TEXT_CLASS[thread.state.tone],
            )}
          >
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", TONE_DOT_CLASS[thread.state.tone])}
            />
            {thread.state.label}
          </span>
          {context.length > 0 ? (
            <>
              <span aria-hidden className="shrink-0 text-muted-foreground/50">
                ·
              </span>
              <span className="min-w-0 truncate">{context}</span>
            </>
          ) : null}
        </span>
      </span>
      {thread.timestampLabel ? (
        <span className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground/70">
          {thread.timestampLabel}
        </span>
      ) : null}
    </Link>
  );
}

function ProjectStartRow(props: {
  readonly project: LaunchpadProject;
  readonly isStarting: boolean;
  readonly onStart: (project: LaunchpadProject) => void;
}) {
  const { project } = props;
  const countLabel = `${project.threadCount} ${project.threadCount === 1 ? "thread" : "threads"}`;
  const liveLabel =
    project.liveThreadCount > 0 ? ` · ${project.liveThreadCount} need attention or working` : "";
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/40">
      <FolderIcon aria-hidden className="size-4 shrink-0 text-icon-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">{project.title}</span>
        <span className="truncate text-xs text-muted-foreground/75">
          {project.folder}
          <span aria-hidden className="mx-1 text-muted-foreground/50">
            ·
          </span>
          {countLabel}
          {liveLabel}
        </span>
      </div>
      <Button
        size="xs"
        variant="outline"
        disabled={props.isStarting}
        aria-label={`New thread in ${project.title}`}
        onClick={() => props.onStart(project)}
      >
        <PlusIcon className="size-3.5" />
        {props.isStarting ? "Opening…" : "New thread"}
      </Button>
    </div>
  );
}
