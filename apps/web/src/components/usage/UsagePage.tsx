/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=20m; seat=codex; date=2026-10-02 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=grok-4.7; effort=default; duration=40m; seat=cursor; date=2026-09-30 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=25m; seat=antigravity; date=2026-10-02 */
import {
  assessSpendBudget,
  calculateUsageVelocity,
  usageComparisonCoverage,
} from "@t3tools/shared/usageVelocity";
import { makeUsageReport, usageReportCsv } from "@t3tools/shared/usageExport";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useAtomValue } from "@effect/atom-react";
import {
  USAGE_CONTRACT_VERSION,
  isProviderAvailable,
  type EnvironmentId,
  type UsageProviderKind,
} from "@t3tools/contracts";
import {
  CircleAlertIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  DownloadIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import {
  isCompatibleUsageContractVersion,
  selectUsageModels,
  type DailyTotals,
  type HourlyTotals,
} from "@t3tools/shared/usageMerge";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  enumerateDays,
  enumerateHourStarts,
  formatCount,
  formatDateTimeShort,
  formatDayShort,
  formatHourShort,
  formatPercent,
  formatTokens,
  formatUsd,
} from "@t3tools/shared/usageFormat";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { UsageCalendarHeatmap } from "./UsageCalendarHeatmap";
import { UsageLimitsSection } from "./UsageLimits";
import { mergeUsageProjects } from "@t3tools/shared/usageProjects";
import { UsagePriceOverrides } from "./UsagePriceOverrides";
import { UsageProjectBreakdown } from "./UsageProjectBreakdown";
import { UsageProviderChart, type UsageChartMetric } from "./UsageProviderChart";
import {
  PROVIDER_ORDER,
  PROVIDER_PRESENTATION,
  providersOnUsageScreen,
  usageKindForDriver,
} from "./usageProviders";
import { readUsagePagePreferences, saveUsagePagePreferences } from "./usagePagePreferences";
import {
  makeUsageWindow,
  USAGE_WINDOW_OPTIONS,
  usageWindowOption,
  type UsageWindowPreset,
} from "./usageWindows";

type UsageMetric = UsageChartMetric | "limits";
const METRIC_OPTIONS = [
  { value: "cost", label: "Cost" },
  { value: "tokens", label: "Tokens" },
  { value: "limits", label: "Limits" },
] as const satisfies readonly { value: UsageMetric; label: string }[];

function isUsageMetric(value: string | null | undefined): value is UsageMetric {
  return METRIC_OPTIONS.some((option) => option.value === value);
}

export function UsagePage() {
  const [preferences, setPreferences] = useState(readUsagePagePreferences);
  const [windowSelection, setWindowSelection] = useState(() => ({
    preset: preferences.windowPreset,
    window: makeUsageWindow(preferences.windowPreset),
  }));
  const metric = preferences.metric;
  const showingLimits = metric === "limits";
  const selectedProvider = preferences.provider ?? null;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const [breakdown, setBreakdown] = useState<"model" | "project" | "time">("model");
  const [selectedEnvironmentIds, setSelectedEnvironmentIds] =
    useState<ReadonlySet<EnvironmentId> | null>(null);
  const { preset: windowPreset, window } = windowSelection;
  const selectedWindowOption = usageWindowOption(windowPreset);
  const isHourlyWindow = selectedWindowOption.resolution === "hour";
  const { merged, environments, selectedEnvironments, isPending, isPartial, refresh } = useUsage(
    window,
    selectedEnvironmentIds,
    selectedProvider,
  );
  const projectUsage = useMemo(
    () =>
      mergeUsageProjects(
        selectedEnvironments.flatMap((environment) =>
          environment.summary === null
            ? []
            : [{ environmentId: environment.environmentId, summary: environment.summary }],
        ),
        { provider: selectedProvider },
      ),
    [selectedEnvironments, selectedProvider],
  );
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  const days = useMemo(
    () =>
      windowPreset === "all"
        ? merged.daily.map((period) => period.day)
        : enumerateDays(window.sinceDay, window.untilDay),
    [merged.daily, window.sinceDay, window.untilDay, windowPreset],
  );
  const hours = useMemo(
    () =>
      window.sinceTime === undefined || window.untilTime === undefined
        ? []
        : enumerateHourStarts(window.sinceTime, window.untilTime),
    [window.sinceTime, window.untilTime],
  );
  // Newest first: long windows can run thousands of periods, so the interesting end
  // belongs at the top of the table.
  const breakdownPeriods = useMemo<readonly (DailyTotals | HourlyTotals)[]>(
    () => (isHourlyWindow ? merged.hourly : merged.daily).toReversed(),
    [isHourlyWindow, merged.daily, merged.hourly],
  );
  const [modelSearch, setModelSearch] = useState("");
  const [modelProviderFilter, setModelProviderFilter] = useState<string>("all");
  const filteredBreakdownModels = useMemo(
    () =>
      selectUsageModels(merged.models, {
        metric: metric === "tokens" ? "tokens" : "cost",
        query: modelSearch,
        provider: modelProviderFilter === "all" ? null : modelProviderFilter,
      }),
    [merged.models, metric, modelSearch, modelProviderFilter],
  );

  const velocity = calculateUsageVelocity({
    costUsd: merged.costUsd,
    totalTokens: merged.totalTokens,
    window,
    allHistory: windowPreset === "all",
    observedDays: days,
  });

  const monthlyBudgetUsd = preferences.monthlyBudgetUsd ?? null;
  const comparisonCoverage = usageComparisonCoverage({
    unpricedShare: merged.costQuality.unpricedShare,
    staleEnvironmentCount: merged.staleEnvironments.length,
    provider: selectedProvider,
    environments: selectedEnvironments,
  });
  const budgetAssessment = useMemo(
    () =>
      assessSpendBudget({
        monthlyBudgetUsd,
        thirtyDayCostUsd: velocity?.thirtyDayCostUsd,
        comparisonCoverage,
      }),
    [monthlyBudgetUsd, velocity?.thirtyDayCostUsd, comparisonCoverage],
  );

  const selectBudget = (budget: number | null) => {
    const nextPreferences = { ...preferences, monthlyBudgetUsd: budget };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
  };
  const connectedProviders = useMemo(() => {
    const found = new Set<UsageProviderKind>();
    for (const [envId, presentation] of presentations) {
      if (selectedEnvironmentIds !== null && !selectedEnvironmentIds.has(envId)) continue;
      for (const provider of presentation.serverConfig?.providers ?? []) {
        const kind = usageKindForDriver(provider.driver);
        if (kind) {
          if (
            provider.enabled ||
            provider.installed ||
            provider.status === "ready" ||
            isProviderAvailable(provider)
          ) {
            found.add(kind);
          }
        }
      }
    }
    return Array.from(found);
  }, [presentations, selectedEnvironmentIds]);
  const availableProviders = useMemo(
    () =>
      providersOnUsageScreen(
        merged.providers,
        selectedEnvironments.flatMap((environment) =>
          (environment.summary?.sources ?? []).map((source) => ({
            provider: source.fingerprint.provider,
            status: source.status,
          })),
        ),
        connectedProviders,
      ),
    [connectedProviders, merged.providers, selectedEnvironments],
  );
  const listedProviders = selectedProvider === null ? availableProviders : [selectedProvider];
  const selectProvider = (provider: UsageProviderKind | null) => {
    const nextPreferences = { ...preferences, provider };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
  };
  const timeValueColumnWidth = `${60 / (listedProviders.length + 2)}%`;
  const activePeriods = (isHourlyWindow ? merged.hourly : merged.daily).filter(
    (period) => period.totalTokens > 0,
  ).length;
  const periodAverage = activePeriods === 0 ? 0 : merged.totalTokens / activePeriods;
  const observedInput = merged.uncachedInputTokens + merged.cachedInputTokens;
  const cachedShare = observedInput === 0 ? 0 : merged.cachedInputTokens / observedInput;

  const selectWindow = (preset: UsageWindowPreset) => {
    const nextPreferences = { ...preferences, metric, windowPreset: preset };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
    setWindowSelection({
      preset,
      window: makeUsageWindow(preset),
    });
  };
  const selectMetric = (nextMetric: UsageMetric) => {
    const nextPreferences = { ...preferences, metric: nextMetric, windowPreset };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
  };
  const refreshWindow = () => {
    if (refreshingRef.current) return;

    if (showingLimits) {
      refreshingRef.current = true;
      setIsRefreshing(true);
      void Promise.all(
        Array.from(presentations, ([environmentId, presentation]) => {
          if (selectedEnvironmentIds !== null && !selectedEnvironmentIds.has(environmentId)) return;
          if (presentation.connection.phase === "connected" && presentation.serverConfig !== null) {
            return refreshProviders({ environmentId, input: {} });
          }
        }),
      ).finally(() => {
        refreshingRef.current = false;
        setIsRefreshing(false);
      });
      return;
    }
    const nextWindow = makeUsageWindow(windowPreset);
    if (
      nextWindow.sinceDay !== window.sinceDay ||
      nextWindow.untilDay !== window.untilDay ||
      nextWindow.sinceTime !== window.sinceTime ||
      nextWindow.untilTime !== window.untilTime
    ) {
      setWindowSelection({ preset: windowPreset, window: nextWindow });
    }
    refreshingRef.current = true;
    setIsRefreshing(true);
    void refresh(nextWindow).finally(() => {
      refreshingRef.current = false;
      setIsRefreshing(false);
    });
  };

  const exportReport = (format: "json" | "csv") => {
    if (metric === "limits") return;
    const exportedAt = new Date().toISOString();
    const report = makeUsageReport({
      merged,
      window,
      windowLabel,
      metric,
      exportedAt,
      selectedProvider,
      selectedEnvironmentIds: selectedEnvironmentIds === null ? null : [...selectedEnvironmentIds],
      providers: listedProviders.map((provider) => ({
        provider,
        label: PROVIDER_PRESENTATION[provider].label,
      })),
    });
    const blob = new Blob(
      [format === "json" ? JSON.stringify(report, null, 2) : usageReportCsv(report)],
      { type: format === "json" ? "application/json" : "text/csv;charset=utf-8;" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `t3-usage-${windowPreset}-${selectedProvider ?? "all"}-${exportedAt.slice(0, 10)}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const exportUsage = () => exportReport("json");
  const exportUsageCsv = () => exportReport("csv");
  const windowLabel =
    windowPreset === "all"
      ? "All recorded activity"
      : isHourlyWindow && window.sinceTime !== undefined && window.untilTime !== undefined
        ? `${formatDateTimeShort(window.sinceTime, window.timeZone)} to ${formatDateTimeShort(window.untilTime, window.timeZone)}`
        : `${formatDayShort(window.sinceDay)} to ${formatDayShort(window.untilDay)}`;
  const topbarContent = (
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-2 xl:flex">
      <WorkspaceBreadcrumb ariaLabel="Usage breadcrumb" className="col-span-2 min-w-0">
        <WorkspaceBreadcrumbItem>
          <h1>Usage</h1>
        </WorkspaceBreadcrumbItem>
        <WorkspaceBreadcrumbSeparator />
        <WorkspaceBreadcrumbItem current className="min-w-10">
          <UsageEnvironmentFilter
            environments={environments}
            selectedEnvironments={selectedEnvironments}
            selectedEnvironmentIds={selectedEnvironmentIds}
            onSelectionChange={setSelectedEnvironmentIds}
            showUsageStatus={!showingLimits}
            isPartial={isPartial}
            duplicateSources={merged.duplicateSources}
            staleEnvironments={merged.staleEnvironments}
          />
        </WorkspaceBreadcrumbItem>
        {!showingLimits ? (
          <>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem current className="min-w-0">
              <Select
                value={selectedProvider ?? "all"}
                onValueChange={(value) => {
                  if (value === "all") selectProvider(null);
                  else if (PROVIDER_ORDER.some((provider) => provider === value))
                    selectProvider(value as UsageProviderKind);
                }}
              >
                <SelectTrigger
                  aria-label="Filter usage harness"
                  size="compact"
                  variant="ghost"
                  className="w-auto min-w-0"
                >
                  <SelectValue>
                    {selectedProvider === null
                      ? "All harnesses"
                      : PROVIDER_PRESENTATION[selectedProvider].label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  <SelectItem value="all">All harnesses</SelectItem>
                  {PROVIDER_ORDER.map((provider) => (
                    <SelectItem key={provider} value={provider}>
                      {PROVIDER_PRESENTATION[provider].label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </WorkspaceBreadcrumbItem>
          </>
        ) : null}
      </WorkspaceBreadcrumb>
      {!showingLimits ? (
        <span className="hidden min-w-0 truncate text-xs text-muted-foreground 2xl:block">
          {windowLabel}
        </span>
      ) : null}
      <div className="ms-auto hidden min-w-0 items-center justify-end gap-2 xl:flex">
        <ToggleGroup
          aria-label="Usage metric"
          variant="segmented"
          value={[metric]}
          onValueChange={(next) => {
            const value = next[0];
            if (isUsageMetric(value)) selectMetric(value);
          }}
        >
          {METRIC_OPTIONS.map((option) => (
            <Toggle key={option.value} value={option.value}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
        {/* The period does not apply to Limits, so it stays in place but
            disabled; unmounting it shifted the metric toggle ~300px. */}
        <UsagePeriodSlider value={windowPreset} disabled={showingLimits} onChange={selectWindow} />
        <Button
          onClick={refreshWindow}
          aria-label={showingLimits ? "Refresh limits" : "Refresh usage"}
          aria-busy={isRefreshing}
          disabled={isRefreshing}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshIcon className="size-3.5" refreshing={isRefreshing} />
        </Button>
        {!showingLimits ? (
          <>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label="30-day API-equivalent cost target"
                    title="30-day API-equivalent cost target"
                    size="compact"
                    variant="outline"
                    className="text-xs font-normal"
                  >
                    {monthlyBudgetUsd ? `Target: ${formatUsd(monthlyBudgetUsd)}` : "Target"}
                  </Button>
                }
              />
              <MenuPopup align="end">
                <MenuItem onClick={() => selectBudget(null)}>No target</MenuItem>
                <MenuSeparator />
                <MenuItem onClick={() => selectBudget(25)}>$25 / 30 days</MenuItem>
                <MenuItem onClick={() => selectBudget(50)}>$50 / 30 days</MenuItem>
                <MenuItem onClick={() => selectBudget(100)}>$100 / 30 days</MenuItem>
                <MenuItem onClick={() => selectBudget(250)}>$250 / 30 days</MenuItem>
                <MenuItem onClick={() => selectBudget(500)}>$500 / 30 days</MenuItem>
              </MenuPopup>
            </Menu>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label="Export usage report"
                    title="Export usage report"
                    size="icon-sm"
                    variant="ghost"
                  >
                    <DownloadIcon className="size-3.5" />
                  </Button>
                }
              />
              <MenuPopup align="end">
                <MenuItem onClick={exportUsage}>Export as JSON</MenuItem>
                <MenuItem onClick={exportUsageCsv}>Export as CSV</MenuItem>
              </MenuPopup>
            </Menu>
          </>
        ) : null}
      </div>
      <div className="col-span-2 ms-auto flex min-w-0 items-center justify-end gap-1 xl:hidden">
        <Select
          value={metric}
          onValueChange={(value) => {
            if (isUsageMetric(value)) selectMetric(value);
          }}
        >
          <SelectTrigger
            aria-label="Usage metric"
            size="compact"
            variant="ghost"
            className="w-auto min-w-0"
          >
            <SelectValue>
              {METRIC_OPTIONS.find((option) => option.value === metric)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {METRIC_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={windowPreset}
          disabled={showingLimits}
          onValueChange={(value) => selectWindow(value as UsageWindowPreset)}
        >
          <SelectTrigger
            aria-label="Usage period"
            size="compact"
            variant="ghost"
            className="w-auto min-w-0"
          >
            <SelectValue>{selectedWindowOption.label}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {USAGE_WINDOW_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          onClick={refreshWindow}
          aria-label={showingLimits ? "Refresh limits" : "Refresh usage"}
          aria-busy={isRefreshing}
          disabled={isRefreshing}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshIcon className="size-3.5" refreshing={isRefreshing} />
        </Button>
        {!showingLimits ? (
          <>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label="30-day API-equivalent cost target"
                    title="30-day API-equivalent cost target"
                    size="compact"
                    variant="outline"
                    className="text-xs font-normal"
                  >
                    {monthlyBudgetUsd ? `Target: ${formatUsd(monthlyBudgetUsd)}` : "Target"}
                  </Button>
                }
              />
              <MenuPopup align="end">
                <MenuItem onClick={() => selectBudget(null)}>No target</MenuItem>
                <MenuSeparator />
                <MenuItem onClick={() => selectBudget(25)}>$25 / 30 days</MenuItem>
                <MenuItem onClick={() => selectBudget(50)}>$50 / 30 days</MenuItem>
                <MenuItem onClick={() => selectBudget(100)}>$100 / 30 days</MenuItem>
                <MenuItem onClick={() => selectBudget(250)}>$250 / 30 days</MenuItem>
                <MenuItem onClick={() => selectBudget(500)}>$500 / 30 days</MenuItem>
              </MenuPopup>
            </Menu>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label="Export usage report"
                    title="Export usage report"
                    size="icon-sm"
                    variant="ghost"
                  >
                    <DownloadIcon className="size-3.5" />
                  </Button>
                }
              />
              <MenuPopup align="end">
                <MenuItem onClick={exportUsage}>Export as JSON</MenuItem>
                <MenuItem onClick={exportUsageCsv}>Export as CSV</MenuItem>
              </MenuPopup>
            </Menu>
          </>
        ) : null}
      </div>
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} className="h-auto">
          {topbarContent}
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            {selectedEnvironments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {environments.length === 0
                  ? `Connect an environment to see ${showingLimits ? "limits" : "usage"}.`
                  : `Select an environment to see ${showingLimits ? "limits" : "usage"}.`}
              </p>
            ) : showingLimits ? (
              <UsageLimitsSection selectedEnvironmentIds={selectedEnvironmentIds} />
            ) : isPending ? (
              <UsageSkeleton />
            ) : (
              <>
                <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                  <div className="flex min-w-0 flex-col gap-5">
                    <div className="flex flex-col gap-1">
                      <span className="text-4xl font-semibold text-foreground tabular-nums">
                        {metric === "cost"
                          ? formatUsd(merged.costUsd)
                          : formatTokens(merged.totalTokens)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {metric === "cost"
                          ? `${formatCount(merged.sessions)} sessions · API-equivalent estimate · not billed`
                          : `${formatCount(merged.sessions)} sessions`}
                      </span>
                      {metric === "cost" && merged.costQuality.unpricedShare > 0 ? (
                        <span className="text-xs text-warning-foreground">
                          {formatPercent(merged.costQuality.unpricedShare)} of records are unpriced
                          and excluded
                        </span>
                      ) : null}
                    </div>

                    {listedProviders.map((provider) => {
                      const totals = merged.providers.find((entry) => entry.provider === provider);
                      const share =
                        metric === "cost" ? (totals?.costShare ?? 0) : (totals?.tokenShare ?? 0);
                      const quiet =
                        (totals?.totalTokens ?? 0) === 0 && (totals?.costUsd ?? 0) === 0;
                      const providerSessions = totals?.sessions ?? 0;
                      const sessionLabel = quiet
                        ? "Connected"
                        : `${formatCount(providerSessions)} ${
                            providerSessions === 1 ? "session" : "sessions"
                          }`;
                      return (
                        <div key={provider} className="flex flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-4">
                            <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                              <span
                                aria-hidden
                                className="size-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: PROVIDER_PRESENTATION[provider].color,
                                }}
                              />
                              <ProviderMark provider={provider} className="size-4" />
                              <span className="flex min-w-0 items-baseline gap-1.5">
                                <span className="truncate">
                                  {PROVIDER_PRESENTATION[provider].label}
                                </span>
                                <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground tabular-nums">
                                  {sessionLabel}
                                </span>
                              </span>
                            </span>
                            <span className="shrink-0 text-sm font-medium text-foreground tabular-nums">
                              {metric === "cost"
                                ? formatUsd(totals?.costUsd ?? 0)
                                : formatTokens(totals?.totalTokens ?? 0)}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {quiet
                              ? "No activity in this window"
                              : metric === "cost"
                                ? `${formatPercent(share)} of cost · ${formatTokens(totals?.totalTokens ?? 0)} tokens`
                                : `${formatPercent(share)} of tokens · ${formatUsd(totals?.costUsd ?? 0)}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex min-w-0 flex-col gap-3">
                    <h2 className="text-sm font-medium text-foreground">
                      {isHourlyWindow ? "Hourly" : "Daily"}{" "}
                      {metric === "tokens" ? "processed tokens" : "API-equivalent cost"}
                    </h2>
                    <UsageProviderChart
                      providers={listedProviders}
                      days={days}
                      daily={merged.daily}
                      hours={hours}
                      hourly={merged.hourly}
                      metric={metric}
                      referenceTime={window.untilTime}
                      resolution={isHourlyWindow ? "hour" : "day"}
                      timeZone={window.timeZone}
                    />
                  </div>
                </section>

                {!isHourlyWindow ? (
                  <UsageCalendarHeatmap
                    days={days}
                    daily={merged.daily}
                    metric={metric === "tokens" ? "tokens" : "cost"}
                  />
                ) : null}

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium text-foreground">Totals</h2>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-3 xl:grid-cols-6">
                    <Metric
                      label="Processed tokens"
                      value={formatTokens(merged.totalTokens)}
                      detail={`${formatTokens(periodAverage)} per active ${isHourlyWindow ? "hour" : "day"}`}
                    />
                    <Metric
                      label="Cached input"
                      value={formatTokens(merged.cachedInputTokens)}
                      detail={`${formatPercent(cachedShare)} of observed input`}
                    />
                    <Metric
                      label="Uncached input"
                      value={formatTokens(merged.uncachedInputTokens)}
                      detail={`${formatTokens(merged.cacheCreationTokens)} cache writes`}
                    />
                    <Metric
                      label="Output"
                      value={formatTokens(merged.outputTokens)}
                      detail={`incl. ${formatTokens(merged.reasoningTokens)} reasoning`}
                    />
                    <Metric
                      label="Cache savings"
                      value={formatUsd(merged.costQuality.cacheSavingsUsd)}
                      detail={
                        merged.costUsd > 0
                          ? `${(merged.costQuality.cacheSavingsUsd / merged.costUsd).toFixed(1)}x raw API cost`
                          : "vs full input rates"
                      }
                    />
                    <Metric
                      label="Unpriced"
                      value={formatPercent(merged.costQuality.unpricedShare)}
                      detail="records excluded from cost"
                      warning={merged.costQuality.unpricedShare > 0}
                    />
                    {budgetAssessment ? (
                      <div
                        className={cn(
                          "col-span-2 flex flex-col gap-2 rounded-lg border p-3.5 text-xs md:col-span-3 xl:col-span-6",
                          budgetAssessment.status === "exceeded"
                            ? "border-destructive/40 bg-destructive/5"
                            : budgetAssessment.status === "warning" ||
                                budgetAssessment.status === "unknown"
                              ? "border-amber-500/40 bg-amber-500/5"
                              : "border-border/60 bg-muted/20",
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                budgetAssessment.status === "exceeded"
                                  ? "bg-destructive"
                                  : budgetAssessment.status === "warning" ||
                                      budgetAssessment.status === "unknown"
                                    ? "bg-amber-500"
                                    : "bg-emerald-500",
                              )}
                            />
                            <span className="font-medium text-foreground">
                              30-day API-equivalent target:
                            </span>
                            <span className="text-muted-foreground">{budgetAssessment.label}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                            <span className="text-muted-foreground">
                              30-day equivalent:{" "}
                              <strong className="font-semibold text-foreground">
                                {formatUsd(budgetAssessment.thirtyDayCostUsd)}
                              </strong>{" "}
                              of{" "}
                              <strong className="font-semibold text-foreground">
                                {formatUsd(budgetAssessment.monthlyBudgetUsd)}
                              </strong>
                            </span>
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 font-semibold text-[11px]",
                                budgetAssessment.status === "exceeded"
                                  ? "bg-destructive/15 text-destructive"
                                  : budgetAssessment.status === "warning" ||
                                      budgetAssessment.status === "unknown"
                                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                    : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {budgetAssessment.status === "unknown"
                                ? "Unknown"
                                : `${budgetAssessment.percentOfBudget}%`}
                            </span>
                          </div>
                        </div>
                        {budgetAssessment.status !== "unknown" ? (
                          <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-300",
                                budgetAssessment.status === "exceeded"
                                  ? "bg-destructive"
                                  : budgetAssessment.status === "warning"
                                    ? "bg-amber-500"
                                    : "bg-emerald-500",
                              )}
                              style={{
                                width: `${Math.min(budgetAssessment.percentOfBudget, 100)}%`,
                              }}
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="col-span-2 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-border/60 bg-muted/30 px-3.5 py-2 text-xs md:col-span-3 xl:col-span-6">
                      <span className="font-medium text-foreground">Recorded usage rate:</span>
                      <span className="text-muted-foreground">
                        API-equivalent average:{" "}
                        <strong className="font-semibold text-foreground tabular-nums">
                          {velocity ? formatUsd(velocity.dailyCostVelocity) : "—"}
                        </strong>
                        /day
                      </span>
                      <span className="text-muted-foreground">
                        30 days at this rate:{" "}
                        <strong className="font-semibold text-foreground tabular-nums">
                          {velocity ? formatUsd(velocity.thirtyDayCostUsd) : "—"}
                        </strong>
                      </span>
                      <span className="text-muted-foreground">
                        Daily token average:{" "}
                        <strong className="font-semibold text-foreground tabular-nums">
                          {velocity ? formatTokens(velocity.dailyTokenVelocity) : "—"}
                        </strong>
                        /day
                      </span>
                      <span className="w-full text-muted-foreground">
                        Based on recorded history
                        {windowPreset === "all"
                          ? " from the first through last recorded day"
                          : " in this window"}
                        ; includes quiet periods. API-equivalent cost, not a subscription bill or
                        forecast.
                      </span>
                    </div>
                  </div>
                </section>

                <section className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-sm font-medium text-foreground">Breakdown</h2>
                      <ToggleGroup
                        aria-label="Usage breakdown"
                        variant="segmented"
                        value={[breakdown]}
                        onValueChange={(next) => {
                          const value = next[0];
                          if (value === "model" || value === "project" || value === "time") setBreakdown(value);
                        }}
                      >
                        {(
                          [
                            { value: "model", label: "Model" },
                            { value: "project", label: "Project" },
                            { value: "time", label: isHourlyWindow ? "Hour" : "Day" },
                          ] as const
                        ).map((option) => (
                          <Toggle key={option.value} value={option.value}>
                            {option.label}
                          </Toggle>
                        ))}
                      </ToggleGroup>
                    </div>

                    {breakdown === "model" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative min-w-40 flex-1 sm:max-w-xs">
                          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                          <Input
                            value={modelSearch}
                            onChange={(e) => setModelSearch(e.currentTarget.value)}
                            placeholder="Search models…"
                            className="h-8 pl-8 text-xs"
                          />
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {["all", ...listedProviders].map((providerKey) => {
                            const isAll = providerKey === "all";
                            const label = isAll
                              ? "All"
                              : (PROVIDER_PRESENTATION[providerKey as UsageProviderKind]?.label ??
                                providerKey);
                            const active = modelProviderFilter === providerKey;
                            return (
                              <button
                                key={providerKey}
                                type="button"
                                onClick={() => setModelProviderFilter(providerKey)}
                                className={cn(
                                  "rounded-sm px-2 py-1 text-xs transition-colors",
                                  active
                                    ? "bg-muted font-medium text-foreground shadow-xs"
                                    : "text-muted-foreground hover:bg-muted/40",
                                )}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {breakdown === "project" ? (
                    <UsageProjectBreakdown
                      summary={projectUsage}
                      hasActivity={merged.models.length > 0}
                    />
                  ) : breakdown === "model" ? (
                    <table className="w-full table-fixed text-sm">
                      <colgroup>
                        <col className="w-2/5" />
                        <col className="w-1/5" />
                        <col className="w-1/5" />
                        <col className="w-1/5" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="py-2 font-normal">Model</th>
                          <th className="py-2 text-right font-normal">Cost</th>
                          <th className="py-2 text-right font-normal">Share</th>
                          <th className="py-2 text-right font-normal">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBreakdownModels.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-muted-foreground">
                              {merged.models.length === 0
                                ? "No activity in this window."
                                : "No matching models."}
                            </td>
                          </tr>
                        ) : (
                          filteredBreakdownModels.map((model) => (
                            <tr
                              key={`${model.provider}:${model.model}`}
                              className="border-b border-border/50 transition-colors hover:bg-muted/50"
                            >
                              <td className="py-2 text-foreground">
                                <span className="flex items-center gap-2">
                                  <ProviderMark provider={model.provider} className="size-3.5" />
                                  {model.model}
                                </span>
                              </td>
                              <td className="py-2 text-right text-foreground tabular-nums">
                                {formatUsd(model.costUsd)}
                              </td>
                              <td className="py-2 text-right text-muted-foreground tabular-nums">
                                {formatPercent(model.costShare)}
                              </td>
                              <td className="py-2 text-right text-muted-foreground tabular-nums">
                                {formatTokens(model.totalTokens)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full table-fixed text-sm">
                      <colgroup>
                        <col className="w-2/5" />
                        {listedProviders.map((provider) => (
                          <col key={provider} style={{ width: timeValueColumnWidth }} />
                        ))}
                        <col style={{ width: timeValueColumnWidth }} />
                        <col style={{ width: timeValueColumnWidth }} />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="py-2 font-normal">{isHourlyWindow ? "Hour" : "Day"}</th>
                          {listedProviders.map((provider) => (
                            <th key={provider} className="py-2 text-right font-normal">
                              {PROVIDER_PRESENTATION[provider].label}
                            </th>
                          ))}
                          <th className="py-2 text-right font-normal">Total</th>
                          <th className="py-2 text-right font-normal">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownPeriods.length === 0 ? (
                          <tr>
                            <td
                              colSpan={listedProviders.length + 3}
                              className="py-6 text-center text-muted-foreground"
                            >
                              No activity in this window.
                            </td>
                          </tr>
                        ) : (
                          breakdownPeriods.map((period) => (
                            <tr
                              key={"hourStart" in period ? period.hourStart : period.day}
                              className="border-b border-border/50 transition-colors hover:bg-muted/50"
                            >
                              <td className="py-2 text-foreground">
                                {"hourStart" in period
                                  ? formatHourShort(period.hourStart, window.timeZone)
                                  : formatDayShort(period.day)}
                              </td>
                              {listedProviders.map((provider) => (
                                <td
                                  key={provider}
                                  className="py-2 text-right text-muted-foreground tabular-nums"
                                >
                                  {formatUsd(period.byProvider.get(provider)?.costUsd ?? 0)}
                                </td>
                              ))}
                              <td className="py-2 text-right text-foreground tabular-nums">
                                {formatUsd(period.costUsd)}
                              </td>
                              <td className="py-2 text-right text-muted-foreground tabular-nums">
                                {formatTokens(period.totalTokens)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}
                </section>
              </>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function UsagePeriodSlider({
  value,
  disabled,
  onChange,
}: {
  readonly value: UsageWindowPreset;
  readonly disabled: boolean;
  readonly onChange: (value: UsageWindowPreset) => void;
}) {
  const selectedIndex = Math.max(
    0,
    USAGE_WINDOW_OPTIONS.findIndex((option) => option.value === value),
  );
  const selected = USAGE_WINDOW_OPTIONS[selectedIndex] ?? USAGE_WINDOW_OPTIONS[6];
  const atLastOption = selectedIndex === USAGE_WINDOW_OPTIONS.length - 1;
  const optionLabels = USAGE_WINDOW_OPTIONS.map((option) => option.label).join(", ");

  return (
    <label className="flex w-96 min-w-72 items-center gap-2 text-xs text-muted-foreground">
      <span className="sr-only">Usage period</span>
      <span id="usage-period-options" className="sr-only">
        Available periods: {optionLabels}
      </span>
      <span className="w-12 shrink-0 text-right text-foreground">
        {atLastOption ? USAGE_WINDOW_OPTIONS[0].label : selected.label}
      </span>
      <input
        aria-label="Usage period"
        aria-describedby="usage-period-options"
        aria-valuetext={selected.label}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
        type="range"
        min={0}
        max={USAGE_WINDOW_OPTIONS.length - 1}
        step={1}
        value={selectedIndex}
        disabled={disabled}
        onChange={(event) => {
          const option = USAGE_WINDOW_OPTIONS[Number(event.currentTarget.value)];
          if (option) onChange(option.value);
        }}
      />
      <span className="w-5 shrink-0">All</span>
    </label>
  );
}

/** Brand mark for the harness a row belongs to. */
function ProviderMark({
  provider,
  className,
}: {
  readonly provider: UsageProviderKind;
  readonly className: string;
}) {
  const Mark = PROVIDER_PRESENTATION[provider].mark;
  return <Mark className={cn("shrink-0", className)} aria-hidden />;
}

function Metric({
  label,
  value,
  detail,
  warning = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly warning?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-base font-medium text-foreground tabular-nums",
          warning && "text-warning-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{detail}</span>
    </div>
  );
}

/**
 * Explains failed or incompatible environments and deduplicated transcripts.
 * Shown inside the environment filter so arriving results do not move the page.
 */
function UsageCoverageNotice({
  environments,
  duplicateSources,
  staleEnvironments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly duplicateSources: readonly string[];
  readonly staleEnvironments: readonly string[];
}) {
  const failed = environments.filter((environment) => environment.error !== null);
  const stale = environments.filter((environment) =>
    staleEnvironments.includes(environment.environmentId),
  );
  if (failed.length === 0 && stale.length === 0 && duplicateSources.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 border-t border-border px-2 py-2 text-xs text-muted-foreground">
      {failed.map((environment) => (
        <span key={environment.label}>{environment.label} could not report usage.</span>
      ))}
      {stale.map((environment) => (
        <span key={environment.label}>
          {environment.label} runs an older server version and is excluded from totals.
        </span>
      ))}
      {duplicateSources.length > 0 ? (
        <span>
          Counted once across environments sharing a transcript directory:{" "}
          {duplicateSources.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

/** Environment selection and scan progress share a permanent header control. */
function UsageEnvironmentFilter({
  environments,
  selectedEnvironments,
  selectedEnvironmentIds,
  onSelectionChange,
  showUsageStatus,
  isPartial,
  duplicateSources,
  staleEnvironments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly onSelectionChange: (ids: ReadonlySet<EnvironmentId> | null) => void;
  readonly showUsageStatus: boolean;
  readonly isPartial: boolean;
  readonly duplicateSources: readonly string[];
  readonly staleEnvironments: readonly string[];
}) {
  const [modelPricesOpen, setModelPricesOpen] = useState(false);
  const allSelected = selectedEnvironmentIds === null;
  const label = allSelected
    ? "All environments"
    : selectedEnvironments.length === 1
      ? selectedEnvironments[0]!.label
      : `${selectedEnvironments.length} environments`;
  const pendingCount = selectedEnvironments.filter(
    (environment) =>
      environment.error === null && (environment.isPending || environment.summary === null),
  ).length;
  const hasIssue =
    selectedEnvironments.some((environment) => environment.error !== null) ||
    staleEnvironments.length > 0;

  return (
    <>
      <Menu>
        <MenuTrigger className="group/usage-environment inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
          <span className="min-w-0 truncate">{label}</span>
          <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
            {showUsageStatus && pendingCount > 0 ? (
              <>
                <CircleDashedIcon className="size-3.5" aria-hidden />
                <span className="sr-only">
                  {pendingCount} {pendingCount === 1 ? "environment" : "environments"} still
                  scanning
                  {isPartial ? "; totals are partial" : ""}
                </span>
              </>
            ) : showUsageStatus && hasIssue ? (
              <CircleAlertIcon
                className="size-3.5 text-amber-600 dark:text-amber-400"
                aria-label="Some environments could not report usage"
              />
            ) : (
              <ChevronDownIcon
                className="size-3.5 opacity-0 transition-opacity group-hover/usage-environment:opacity-100 group-focus-visible/usage-environment:opacity-100 group-data-popup-open/usage-environment:opacity-100"
                aria-hidden
              />
            )}
          </span>
        </MenuTrigger>
        <MenuPopup align="start" className="w-80 max-w-[calc(100vw-2rem)]">
          <MenuCheckboxItem
            checked={allSelected}
            closeOnClick={false}
            onCheckedChange={(checked) => onSelectionChange(checked ? null : new Set())}
          >
            All environments
          </MenuCheckboxItem>
          <MenuSeparator />
          {environments.map((environment) => {
            const checked =
              selectedEnvironmentIds === null ||
              selectedEnvironmentIds.has(environment.environmentId);
            const status =
              environment.error !== null
                ? "Unavailable"
                : environment.summary !== null &&
                    !isCompatibleUsageContractVersion(
                      environment.summary.contractVersion,
                      USAGE_CONTRACT_VERSION,
                    )
                  ? "Update required"
                  : environment.summary === null
                    ? "Scanning…"
                    : environment.isPending
                      ? "Refreshing…"
                      : "Ready";
            return (
              <MenuCheckboxItem
                key={environment.environmentId}
                checked={checked}
                closeOnClick={false}
                className="grid-cols-[1rem_minmax(0,1fr)]"
                onCheckedChange={(nextChecked) => {
                  const next = new Set(selectedEnvironments.map((entry) => entry.environmentId));
                  if (nextChecked) next.add(environment.environmentId);
                  else next.delete(environment.environmentId);
                  onSelectionChange(next.size === environments.length ? null : next);
                }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="min-w-0 flex-1 truncate">{environment.label}</span>
                  {showUsageStatus ? (
                    <span
                      className={cn(
                        "shrink-0 text-xs text-muted-foreground",
                        environment.error !== null && "text-destructive",
                      )}
                    >
                      {status}
                    </span>
                  ) : null}
                </span>
              </MenuCheckboxItem>
            );
          })}
          {environments.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">No environments connected.</p>
          ) : null}
          {showUsageStatus && isPartial ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Totals are partial while selected environments scan.
            </p>
          ) : null}
          {showUsageStatus ? (
            <UsageCoverageNotice
              environments={selectedEnvironments}
              duplicateSources={duplicateSources}
              staleEnvironments={staleEnvironments}
            />
          ) : null}
          <MenuSeparator />
          <MenuItem onClick={() => setModelPricesOpen(true)}>
            <SlidersHorizontalIcon aria-hidden />
            Model prices
          </MenuItem>
        </MenuPopup>
      </Menu>
      {modelPricesOpen ? (
        <UsagePriceOverrides
          usage={environments}
          initialSelectedEnvironmentIds={selectedEnvironmentIds}
          onOpenChange={setModelPricesOpen}
        />
      ) : null}
    </>
  );
}

/**
 * Stand-in with the loaded page's shape, using the shared `Skeleton` bars so it
 * breathes with the same `animate-skeleton` pulse as every other loading state.
 * Replaced by results as soon as the first environment answers.
 */
function UsageSkeleton() {
  return (
    <>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-10 w-36" />
            <Skeleton className="h-4 w-32" />
          </div>
          {PROVIDER_ORDER.map((provider) => (
            <div key={provider} className="flex flex-col gap-1">
              <div className="flex min-h-5 items-center justify-between gap-4">
                <span className="flex items-center gap-2">
                  <Skeleton className="size-2 shrink-0 rounded-full" />
                  <Skeleton className="size-4 shrink-0 rounded-full" />
                  <Skeleton className="h-3.5 w-20" />
                </span>
                <Skeleton className="h-3.5 w-14" />
              </div>
              <Skeleton className="h-4 w-36" />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-24" />
          <div className="flex flex-col gap-1">
            <Skeleton className="ml-16 h-56 bg-muted-foreground/10" />
            <Skeleton className="ml-16 h-4 bg-muted-foreground/10" />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">Totals</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-5">
          {["Processed tokens", "Cached input", "Uncached input", "Output", "Cache savings"].map(
            (label) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Skeleton className="h-6 w-16" />
              </div>
            ),
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">Breakdown</h2>
          <Skeleton className="h-7 w-28 rounded-lg" />
        </div>
        <Skeleton className="h-44 bg-muted-foreground/10" />
      </section>
    </>
  );
}
