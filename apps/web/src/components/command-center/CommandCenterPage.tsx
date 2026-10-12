/* agent-watermark: model=opus-5.5; effort=high; duration=30m; seat=claude-code; date=2026-10-12 */
/* agent-watermark: model=haiku-5.5; effort=high; duration=29m; seat=claude-code; date=2026-10-12 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=10m; seat=antigravity; date=2026-10-10 */
/* agent-watermark: model=muse-spark; effort=high; duration=50m; seat=opencode; date=2026-10-07 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=6m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=grok-4.7; effort=default; duration=58m; seat=cursor; date=2026-09-30 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=15m; seat=antigravity; date=2026-09-30 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=10m; seat=antigravity; date=2026-10-01 */
import { Link } from "@tanstack/react-router";
import { formatTokens, formatUsd, makeWindow } from "@t3tools/shared/usageFormat";
import {
  isProviderAvailable,
  type RoutineDefinition,
  type ServerProvider,
  type UsageProviderKind,
} from "@t3tools/contracts";
import { groupRaces } from "../race/race.logic";
import {
  CalendarClockIcon,
  ChartNoAxesColumnIcon,
  LayoutDashboardIcon,
  PlayIcon,
  SparklesIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { useUsage } from "../../state/usage";
import { mergeUsageProjects } from "@t3tools/shared/usageProjects";
import {
  PROVIDER_PRESENTATION,
  providersOnUsageScreen,
  usageKindForDriver,
} from "../usage/usageProviders";
import { MissionLauncher } from "./MissionLauncher";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
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
  selectMissionQueue,
  type MissionQueueFilter,
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
  | "/usage"
  | "/race";

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
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [queueFilter, setQueueFilter] = useState<MissionQueueFilter>("active");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [queueSearch, setQueueSearch] = useState("");
  const [queueLimit, setQueueLimit] = useState(10);
  const usageWindow = useMemo(() => makeWindow(7), []);
  const usage = useUsage(usageWindow);
  const topProjects = useMemo(
    () =>
      mergeUsageProjects(
        usage.selectedEnvironments.flatMap((environment) =>
          environment.summary === null
            ? []
            : [{ environmentId: environment.environmentId, summary: environment.summary }],
        ),
      )
        .projects.filter((project) => project.projectPath !== null)
        .slice(0, 4),
    [usage.selectedEnvironments],
  );
  const usageByKind = useMemo(() => {
    const totals = new Map<string, { readonly totalTokens: number; readonly costUsd: number }>();
    for (const provider of usage.merged.providers) {
      totals.set(provider.provider, {
        totalTokens: provider.totalTokens,
        costUsd: provider.costUsd,
      });
    }
    return totals;
  }, [usage.merged.providers]);
  const providers = useMemo(
    () => environments.flatMap((environment) => environment.serverConfig?.providers ?? []),
    [environments],
  );
  const connectedProviders = useMemo(() => {
    const found = new Set<UsageProviderKind>();
    for (const provider of providers) {
      const kind = usageKindForDriver(provider.driver);
      if (
        kind &&
        (provider.enabled ||
          provider.installed ||
          provider.status === "ready" ||
          isProviderAvailable(provider))
      ) {
        found.add(kind);
      }
    }
    return Array.from(found);
  }, [providers]);
  const harnessUsage = useMemo(
    () =>
      providersOnUsageScreen(
        usage.merged.providers,
        usage.selectedEnvironments.flatMap((environment) =>
          (environment.summary?.sources ?? []).map((source) => ({
            provider: source.fingerprint.provider,
            status: source.status,
          })),
        ),
        connectedProviders,
      ),
    [connectedProviders, usage.merged.providers, usage.selectedEnvironments],
  );
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
  const queueProjects = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ readonly key: string; readonly title: string }> = [];
    for (const thread of threads) {
      if (thread.archivedAt !== null) continue;
      const key = `${thread.environmentId}\0${thread.projectId}`;
      if (!seen.has(key)) {
        seen.add(key);
        const project = projectsByKey.get(`${thread.environmentId}\0${thread.projectId}`);
        list.push({
          key,
          title: project?.title ?? "Unknown project",
        });
      }
    }
    return list.sort((a, b) => a.title.localeCompare(b.title));
  }, [projectsByKey, threads]);
  const missionQueue = useMemo(
    () =>
      selectMissionQueue(
        threads,
        queueFilter,
        queueSearch,
        (thread) => {
          const project = projectsByKey.get(`${thread.environmentId}\0${thread.projectId}`);
          const provider = providersByEnvironmentAndInstance.get(
            `${thread.environmentId}\0${thread.modelSelection.instanceId}`,
          );
          return [
            thread.title,
            project?.title,
            environmentsById.get(thread.environmentId)?.label,
            provider?.displayName,
            thread.modelSelection.instanceId,
          ]
            .filter(Boolean)
            .join(" ");
        },
        projectFilter === "all"
          ? undefined
          : (thread) => `${thread.environmentId}\0${thread.projectId}` === projectFilter,
      ),
    [
      threads,
      queueFilter,
      queueSearch,
      projectsByKey,
      providersByEnvironmentAndInstance,
      environmentsById,
      projectFilter,
    ],
  );
  const activeThreads = missionQueue.slice(0, queueLimit);
  const activeRaces = useMemo(() => groupRaces(threads), [threads]);
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
            <Button size="sm" variant="outline" onClick={() => setLauncherOpen(true)}>
              <PlayIcon /> New task
            </Button>
          </div>
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            <section
              aria-label="At a glance"
              className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 xl:grid-cols-6"
            >
              <Metric label="Active missions" value={String(summary.activeMissions)} to="/" />
              <Metric
                label="Needs attention"
                value={String(attentionTotal)}
                to="/"
                tone={attentionTotal > 0 ? "warning" : undefined}
              />
              <Metric
                label="Harnesses ready"
                value={formatHarnessReadiness(summary.readyProviders, summary.totalProviders)}
                to="/settings/providers"
                tone={summary.readyProviders < summary.totalProviders ? "warning" : undefined}
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
              <Metric label="Active races" value={String(activeRaces.length)} to="/race" />
            </section>

            <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]">
              <section className="flex min-h-0 min-w-0 flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium">Mission queue</h2>
                  <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
                    All threads
                  </Link>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label="Search missions"
                    type="search"
                    size="compact"
                    className="min-w-0 flex-1"
                    placeholder="Search missions, projects, computers…"
                    value={queueSearch}
                    onChange={(event) => {
                      setQueueSearch(event.currentTarget.value);
                      setQueueLimit(10);
                    }}
                  />
                  <ToggleGroup
                    aria-label="Mission queue filter"
                    className="shrink-0"
                    value={[queueFilter]}
                    onValueChange={(value) => {
                      const next = value[0];
                      if (next !== "active" && next !== "attention" && next !== "all") return;
                      setQueueFilter(next);
                      setQueueLimit(10);
                    }}
                  >
                    <Toggle value="active">Active</Toggle>
                    <Toggle value="attention">Needs attention</Toggle>
                    <Toggle value="all">All</Toggle>
                  </ToggleGroup>
                  {queueSearch.trim() || queueFilter !== "active" || projectFilter !== "all" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Reset mission filters"
                      onClick={() => {
                        setQueueSearch("");
                        setQueueFilter("active");
                        setProjectFilter("all");
                        setQueueLimit(10);
                      }}
                    >
                      Reset
                    </Button>
                  ) : null}
                </div>
                {queueProjects.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-xs text-muted-foreground">Project:</span>
                    <button
                      type="button"
                      onClick={() => {
                        setProjectFilter("all");
                        setQueueLimit(10);
                      }}
                      className={cn(
                        "rounded-md px-2 py-0.5 text-xs transition-colors",
                        projectFilter === "all"
                          ? "bg-muted font-medium text-foreground shadow-xs"
                          : "text-muted-foreground hover:bg-muted/40",
                      )}
                    >
                      All
                    </button>
                    {queueProjects.map(({ key, title }) => {
                      const active = projectFilter === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setProjectFilter(key);
                            setQueueLimit(10);
                          }}
                          className={cn(
                            "rounded-md px-2 py-0.5 text-xs transition-colors",
                            active
                              ? "bg-muted font-medium text-foreground shadow-xs"
                              : "text-muted-foreground hover:bg-muted/40",
                          )}
                        >
                          {title}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col border-y border-border">
                  {activeThreads.length === 0 ? (
                    queueSearch.trim() || projectFilter !== "all" ? (
                      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 py-12 text-sm text-muted-foreground">
                        <LayoutDashboardIcon className="size-5 text-icon-muted" />
                        <span>No matching missions.</span>
                      </div>
                    ) : queueFilter === "active" ? (
                      <div className="flex flex-1 flex-col justify-center gap-4 px-4 py-10">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-sm font-medium text-foreground">
                            No active missions
                          </span>
                          <span className="max-w-prose text-sm text-muted-foreground">
                            A task is one agent working in one of your projects. Start one here, and
                            its progress appears in this queue until it settles.
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" onClick={() => setLauncherOpen(true)}>
                            <PlayIcon /> New task
                          </Button>
                          <Button size="sm" variant="ghost" render={<Link to="/routines" />}>
                            Schedule a routine
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 py-12 text-sm text-muted-foreground">
                        <LayoutDashboardIcon className="size-5 text-icon-muted" />
                        <span>
                          {queueFilter === "attention"
                            ? "No missions need attention."
                            : "No missions yet."}
                        </span>
                      </div>
                    )
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
                {missionQueue.length > 0 ? (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span aria-live="polite">
                      {Math.min(queueLimit, missionQueue.length)} of {missionQueue.length} missions
                    </span>
                    {missionQueue.length > queueLimit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setQueueLimit((limit) => limit + 10)}
                      >
                        Show more
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <aside className="flex min-w-0 flex-col gap-4">
                <Link
                  to="/usage"
                  className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">Usage · 7 days</span>
                    <span className="text-[11px] text-muted-foreground">
                      API-equivalent, not billed
                    </span>
                  </span>
                  <span className="flex items-baseline gap-2">
                    {usage.isPending ? (
                      <Skeleton className="h-7 w-24" />
                    ) : (
                      <span className="text-2xl font-semibold tabular-nums">
                        {formatUsd(usage.merged.costUsd)}
                      </span>
                    )}
                    <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
                      {usage.isPending
                        ? "Reading usage…"
                        : `${formatTokens(usage.merged.totalTokens)} tokens`}
                    </span>
                  </span>
                  {harnessUsage.length > 0 ? (
                    <span className="flex flex-col border-t border-border pt-2">
                      {harnessUsage.map((provider) => {
                        const totals = usage.merged.providers.find(
                          (entry) => entry.provider === provider,
                        );
                        const quiet =
                          (totals?.totalTokens ?? 0) === 0 && (totals?.costUsd ?? 0) === 0;
                        return (
                          <span
                            key={provider}
                            className="flex items-baseline justify-between gap-3 py-1 text-xs"
                          >
                            <span className={quiet ? "text-muted-foreground" : undefined}>
                              {PROVIDER_PRESENTATION[provider].label}
                            </span>
                            {/* While the scan runs nothing is known yet; "No activity" was a claim. */}
                            {usage.isPending ? (
                              <Skeleton className="h-3 w-12" />
                            ) : (
                              <span
                                className={cn(
                                  "tabular-nums",
                                  quiet ? "text-muted-foreground/60" : "text-muted-foreground",
                                )}
                              >
                                {quiet ? "No activity" : formatTokens(totals?.totalTokens ?? 0)}
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </span>
                  ) : null}
                </Link>
                {topProjects.length > 0 ? (
                  <Link
                    to="/usage"
                    className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20"
                  >
                    <span className="mb-1 text-sm font-medium">Top projects · 7 days</span>
                    {topProjects.map((project) => (
                      <span key={project.key} className="flex items-baseline gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatUsd(project.costUsd)}
                        </span>
                      </span>
                    ))}
                  </Link>
                ) : null}
              </aside>
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
                <table className="w-full min-w-[48rem] table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="w-[22%] py-2 font-normal">Harness / subscription</th>
                      <th className="w-[16%] py-2 font-normal">Environment</th>
                      <th className="w-[22%] py-2 font-normal">Authentication</th>
                      <th className="w-[16%] py-2 font-normal">Default model</th>
                      <th className="w-[14%] py-2 text-right font-normal">7 days</th>
                      <th className="py-2 text-right font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enabledProviderRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="border-b border-border py-6">
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
                          <td className="py-2.5 pr-3">
                            <span className="block truncate">
                              {provider.models.find((model) => model.isDefault)?.shortName ??
                                provider.models.find((model) => model.isDefault)?.name ??
                                provider.models[0]?.shortName ??
                                provider.models[0]?.name ??
                                "—"}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {provider.models.length === 1
                                ? "1 model"
                                : `${provider.models.length} models`}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-right text-xs tabular-nums text-muted-foreground">
                            <HarnessWeekUsage
                              driver={provider.driver}
                              usageByKind={usageByKind}
                              status={environmentUsageStatus(
                                usage.environments.find(
                                  (entry) => entry.environmentId === environment.environmentId,
                                ),
                              )}
                            />
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
                        {routine.lastRunStatus === "failed" && routine.lastError ? (
                          <span className="ml-1 text-destructive">· {routine.lastError}</span>
                        ) : null}
                      </span>
                    </span>
                    <div className="mr-2 flex shrink-0 items-center gap-2">
                      {routine.lastRunStatus === "failed" ? (
                        <Badge variant="error">Failed</Badge>
                      ) : null}
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {routine.enabled && routine.nextRunAt
                          ? relativeTime(routine.nextRunAt)
                          : "—"}
                      </span>
                    </div>
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
      {launcherOpen ? <MissionLauncher open onOpenChange={setLauncherOpen} /> : null}
    </SidebarInset>
  );
}

type HarnessUsageStatus = "reading" | "answered" | "unavailable";

/**
 * A row reads "reading" only while its environment is still scanning. Once it
 * answers, the cell shows totals; if it fails or never answers, the cell shows a
 * dash rather than a word that claims something is still happening.
 */
function environmentUsageStatus(
  environment: { readonly summary: unknown; readonly error: string | null } | undefined,
): HarnessUsageStatus {
  if (environment?.summary) return "answered";
  if (environment && environment.error === null) return "reading";
  return "unavailable";
}

function HarnessWeekUsage({
  driver,
  usageByKind,
  status,
}: {
  readonly status: HarnessUsageStatus;
  readonly driver: string;
  readonly usageByKind: ReadonlyMap<
    string,
    { readonly totalTokens: number; readonly costUsd: number }
  >;
}) {
  const kind = usageKindForDriver(driver);
  if (kind === null || status === "unavailable") return <span>—</span>;
  if (status === "reading") {
    return (
      <>
        <Skeleton className="ml-auto h-3 w-10" />
        <span className="sr-only">Reading usage</span>
      </>
    );
  }
  const totals = usageByKind.get(kind);
  if (totals === undefined || (totals.totalTokens === 0 && totals.costUsd === 0)) {
    return <span>No activity</span>;
  }
  return <span>{formatTokens(totals.totalTokens)}</span>;
}

function Metric({
  label,
  value,
  to,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly to: CommandCenterDestination;
  readonly tone?: "warning" | undefined;
}) {
  return (
    <Link
      to={to}
      className="group flex min-w-0 flex-col gap-1 bg-card px-4 py-3.5 transition-colors hover:bg-muted/30"
    >
      <span
        className={cn(
          "text-2xl font-semibold tabular-nums leading-none",
          tone === "warning" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </span>
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
