import { Link } from "@tanstack/react-router";
import { formatTokens, formatUsd, makeWindow } from "@t3tools/shared/usageFormat";
import type { RoutineDefinition, ServerProvider } from "@t3tools/contracts";
import {
  CalendarClockIcon,
  ChartNoAxesColumnIcon,
  LayoutDashboardIcon,
  PlayIcon,
  SparklesIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { useUsage } from "../../state/usage";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  buildCommandCenterSummary,
  commandCenterThreadStatus,
  formatConnectionSummary,
  formatHarnessReadiness,
  sortUpcomingRoutines,
  type CommandCenterThreadStatus,
} from "./commandCenter.logic";

const STATUS_PRESENTATION: Record<
  CommandCenterThreadStatus,
  {
    readonly label: string;
    readonly dot: string;
    readonly badge: "info" | "warning" | "error" | "secondary";
  }
> = {
  working: { label: "Working", dot: "bg-info", badge: "info" },
  monitoring: { label: "Monitoring", dot: "bg-success", badge: "secondary" },
  approval: { label: "Approval", dot: "bg-warning", badge: "warning" },
  input: { label: "Input needed", dot: "bg-warning", badge: "warning" },
  failed: { label: "Failed", dot: "bg-destructive", badge: "error" },
  ready: { label: "Ready", dot: "bg-muted-foreground/45", badge: "secondary" },
};

interface RoutineRow {
  readonly id: string;
  readonly environmentLabel: string;
  readonly routine: RoutineDefinition;
}

type CommandCenterDestination =
  | "/"
  | "/settings/connections"
  | "/settings/providers"
  | "/settings/skills"
  | "/routines"
  | "/usage";

function relativeTime(value: string): string {
  const delta = Date.parse(value) - Date.now();
  if (!Number.isFinite(delta)) return "Unknown";
  const absolute = Math.abs(delta);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (absolute < 60 * 60 * 1_000) return formatter.format(Math.round(delta / 60_000), "minute");
  if (absolute < 24 * 60 * 60 * 1_000) {
    return formatter.format(Math.round(delta / (60 * 60 * 1_000)), "hour");
  }
  return formatter.format(Math.round(delta / (24 * 60 * 60 * 1_000)), "day");
}

function providerLabel(provider: Pick<ServerProvider, "displayName" | "instanceId">): string {
  return provider.displayName?.trim() || provider.instanceId;
}

export function CommandCenterPage() {
  const { environments } = useEnvironments();
  const projects = useProjects();
  const threads = useThreadShells();
  const usageWindow = useMemo(() => makeWindow(7), []);
  const usage = useUsage(usageWindow);
  const projectsByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [`${project.environmentId}\0${project.id}`, project] as const),
      ),
    [projects],
  );
  const environmentsById = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment] as const)),
    [environments],
  );
  const providers = useMemo(
    () => environments.flatMap((environment) => environment.serverConfig?.providers ?? []),
    [environments],
  );
  const enabledProviderRows = useMemo(
    () =>
      environments.flatMap((environment) =>
        (environment.serverConfig?.providers ?? [])
          .filter((provider) => provider.enabled)
          .map((provider) => ({ environment, provider })),
      ),
    [environments],
  );
  const providersByEnvironmentAndInstance = useMemo(
    () =>
      new Map(
        environments.flatMap((environment) =>
          (environment.serverConfig?.providers ?? []).map(
            (provider) =>
              [`${environment.environmentId}\0${provider.instanceId}`, provider] as const,
          ),
        ),
      ),
    [environments],
  );
  const routines = useMemo<RoutineRow[]>(
    () =>
      environments.flatMap((environment) =>
        Object.entries(environment.serverConfig?.settings.routines ?? {}).map(([id, routine]) => ({
          id,
          environmentLabel: environment.label,
          routine,
        })),
      ),
    [environments],
  );
  const summary = useMemo(
    () =>
      buildCommandCenterSummary({
        threads,
        providers,
        routines: routines.map(({ routine }) => routine),
      }),
    [providers, routines, threads],
  );
  const activeThreads = useMemo(
    () =>
      threads
        .filter(
          (thread) => thread.archivedAt === null && commandCenterThreadStatus(thread) !== "ready",
        )
        .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, 10),
    [threads],
  );
  const upcomingRoutines = useMemo(() => sortUpcomingRoutines(routines).slice(0, 6), [routines]);
  const enabledSkills = enabledProviderRows.reduce(
    (total, { provider }) => total + provider.skills.filter((skill) => skill.enabled).length,
    0,
  );
  const connectedEnvironments = environments.filter(
    (environment) => environment.connection.phase === "connected",
  ).length;
  const needsConnectionSetup =
    environments.length === 0 || connectedEnvironments < environments.length;
  const attentionTotal = summary.attentionItems + summary.failedRoutines;

  return (
    <SidebarInset className="isolate h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} className="h-auto">
          <div className="flex w-full min-w-0 items-center gap-3 py-2">
            <WorkspaceBreadcrumb ariaLabel="Command Center breadcrumb" className="min-w-0">
              <WorkspaceBreadcrumbItem>
                <LayoutDashboardIcon className="size-3.5" />
                <h1>Command Center</h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
            <Link
              to="/settings/connections"
              className={cn(
                "ml-auto hidden items-center gap-1.5 text-xs hover:text-foreground sm:flex",
                needsConnectionSetup ? "text-warning" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  needsConnectionSetup ? "bg-warning" : "bg-success",
                )}
              />
              {formatConnectionSummary(connectedEnvironments, environments.length)}
            </Link>
            <Button size="sm" variant="outline" render={<Link to="/" />}>
              <PlayIcon /> New task
            </Button>
          </div>
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <span className="text-4xl font-semibold tabular-nums">
                    {summary.activeMissions}
                  </span>
                  <span className="text-xs text-muted-foreground">active missions</span>
                </div>
                <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                  <Metric label="Needs attention" value={String(attentionTotal)} to="/" />
                  <Metric
                    label="Harnesses ready"
                    value={formatHarnessReadiness(summary.readyProviders, summary.totalProviders)}
                    to="/settings/providers"
                  />
                  <Metric
                    label="Scheduled routines"
                    value={String(summary.enabledRoutines)}
                    to="/routines"
                  />
                  <Metric
                    label="Available skills"
                    value={String(enabledSkills)}
                    to="/settings/skills"
                  />
                </div>
                <Link
                  to="/usage"
                  className="flex flex-col gap-1 border-t border-border pt-4 hover:text-foreground"
                >
                  <span className="text-lg font-medium tabular-nums">
                    {usage.isPending ? "…" : formatUsd(usage.merged.costUsd)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTokens(usage.merged.totalTokens)} · API-equivalent · past 7 days · not
                    billed
                  </span>
                </Link>
              </div>

              <section className="flex min-w-0 flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium">Mission queue</h2>
                  <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
                    All threads
                  </Link>
                </div>
                <div className="min-w-0 border-y border-border">
                  {activeThreads.length === 0 ? (
                    <div className="flex items-center justify-center gap-1.5 py-6 text-sm text-muted-foreground">
                      <span>No active missions.</span>
                      <Link to="/" className="text-foreground hover:underline">
                        Start a task
                      </Link>
                    </div>
                  ) : (
                    activeThreads.map((thread) => {
                      const status = commandCenterThreadStatus(thread);
                      const presentation = STATUS_PRESENTATION[status];
                      const project = projectsByKey.get(
                        `${thread.environmentId}\0${thread.projectId}`,
                      );
                      const provider = providersByEnvironmentAndInstance.get(
                        `${thread.environmentId}\0${thread.modelSelection.instanceId}`,
                      );
                      return (
                        <Link
                          key={`${thread.environmentId}:${thread.id}`}
                          to="/$environmentId/$threadId"
                          params={{ environmentId: thread.environmentId, threadId: thread.id }}
                          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-2.5 last:border-b-0 hover:bg-muted/25"
                        >
                          <span className="min-w-0 px-2">
                            <span className="block truncate text-sm">{thread.title}</span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {project?.title ?? "Unknown project"} ·{" "}
                              {provider
                                ? providerLabel(provider)
                                : thread.modelSelection.instanceId}{" "}
                              · {environmentsById.get(thread.environmentId)?.label ?? "Environment"}
                            </span>
                          </span>
                          <Badge className="mr-2" variant={presentation.badge}>
                            <span className={cn("size-1.5 rounded-full", presentation.dot)} />
                            {presentation.label}
                          </Badge>
                        </Link>
                      );
                    })
                  )}
                </div>
              </section>
            </section>

            <section className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">Harness and subscription readiness</h2>
                <Link
                  to="/settings/providers"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Configure
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[42rem] table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="w-1/4 py-2 font-normal">Harness / subscription</th>
                      <th className="w-1/5 py-2 font-normal">Environment</th>
                      <th className="w-1/4 py-2 font-normal">Authentication</th>
                      <th className="w-1/5 py-2 font-normal">Default model</th>
                      <th className="py-2 text-right font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enabledProviderRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="border-b border-border py-6">
                          <div className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                            <span>No enabled harnesses.</span>
                            <Link
                              to="/settings/providers"
                              className="text-foreground hover:underline"
                            >
                              Set up providers
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      enabledProviderRows.map(({ environment, provider }) => (
                        <tr
                          key={`${environment.environmentId}:${provider.instanceId}`}
                          className="border-b border-border last:border-b-0 hover:bg-muted/25"
                        >
                          <td className="truncate py-2.5 pr-3 font-medium">
                            <Link
                              to="/settings/providers"
                              search={{
                                environmentId: environment.environmentId,
                                instanceId: provider.instanceId,
                              }}
                              className="hover:underline"
                            >
                              {providerLabel(provider)}
                            </Link>
                          </td>
                          <td className="truncate py-2.5 pr-3 text-muted-foreground">
                            {environment.label}
                          </td>
                          <td className="truncate py-2.5 pr-3 text-muted-foreground">
                            {provider.auth.label ?? provider.auth.email ?? provider.auth.status}
                          </td>
                          <td className="truncate py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                            {provider.models.find((model) => model.isDefault)?.shortName ??
                              provider.models.find((model) => model.isDefault)?.name ??
                              provider.models[0]?.shortName ??
                              provider.models[0]?.name ??
                              "—"}
                          </td>
                          <td className="py-2.5 text-right">
                            <Badge
                              variant={
                                provider.status === "ready"
                                  ? "success"
                                  : provider.status === "warning"
                                    ? "warning"
                                    : "error"
                              }
                            >
                              {provider.status}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <ListSection
                title="Upcoming routines"
                action="Manage"
                to="/routines"
                empty="No routines configured yet."
              >
                {upcomingRoutines.map(({ id, environmentLabel, routine }) => (
                  <Link
                    key={`${environmentLabel}:${id}`}
                    to="/routines"
                    className="flex min-w-0 items-center gap-3 border-b border-border py-2.5 last:border-b-0 hover:bg-muted/25"
                  >
                    <span
                      className={cn(
                        "ml-2 size-2 shrink-0 rounded-full",
                        routine.lastRunStatus === "failed"
                          ? "bg-destructive"
                          : routine.enabled
                            ? "bg-success"
                            : "bg-muted-foreground/40",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{routine.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {environmentLabel} · {routine.enabled ? routine.cron : "Paused"}
                      </span>
                    </span>
                    <span className="mr-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {routine.enabled && routine.nextRunAt ? relativeTime(routine.nextRunAt) : "—"}
                    </span>
                  </Link>
                ))}
              </ListSection>

              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-medium">Command surfaces</h2>
                <div className="divide-y divide-border border-y border-border">
                  <SurfaceLink
                    to="/settings/skills"
                    icon={<SparklesIcon />}
                    title="Skills"
                    detail="Inspect reusable instructions by harness and computer"
                  />
                  <SurfaceLink
                    to="/routines"
                    icon={<CalendarClockIcon />}
                    title="Routines"
                    detail="Run, pause, duplicate, or retarget scheduled work"
                  />
                  <SurfaceLink
                    to="/usage"
                    icon={<ChartNoAxesColumnIcon />}
                    title="Usage"
                    detail="Explore one hour through all-time API-equivalent cost"
                  />
                </div>
              </section>
            </section>
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function Metric({
  label,
  value,
  to,
}: {
  readonly label: string;
  readonly value: string;
  readonly to: CommandCenterDestination;
}) {
  return (
    <Link to={to} className="group flex min-w-0 flex-col gap-0.5">
      <span className="text-lg font-medium tabular-nums">{value}</span>
      <span className="truncate text-xs text-muted-foreground group-hover:text-foreground">
        {label}
      </span>
    </Link>
  );
}

function ListSection({
  title,
  action,
  to,
  empty,
  children,
}: {
  readonly title: string;
  readonly action: string;
  readonly to: "/routines";
  readonly empty: string;
  readonly children: ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : children !== null;
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <Link to={to} className="text-xs text-muted-foreground hover:text-foreground">
          {action}
        </Link>
      </div>
      <div className="border-y border-border">
        {hasChildren ? (
          children
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
        )}
      </div>
    </section>
  );
}

function SurfaceLink({
  to,
  icon,
  title,
  detail,
}: {
  readonly to: "/settings/skills" | "/routines" | "/usage";
  readonly icon: ReactNode;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <Link to={to} className="flex items-center gap-3 px-2 py-3 hover:bg-muted/25">
      <span className="text-icon-muted [&_svg]:size-4">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
    </Link>
  );
}
