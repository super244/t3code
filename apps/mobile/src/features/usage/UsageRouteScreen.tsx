/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=8m; seat=codex; date=2026-10-17 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=60m; seat=codex; date=2026-10-15 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=5m; seat=codex; date=2026-10-02 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=15m; seat=antigravity; date=2026-10-02 */
import {
  EnvironmentId,
  isProviderAvailable,
  USAGE_CONTRACT_VERSION,
  type UsageProviderKind,
} from "@t3tools/contracts";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useNavigation } from "@react-navigation/native";
import {
  isCompatibleUsageContractVersion,
  selectUsageModels,
  type DailyTotals,
  type MergedUsage,
} from "@t3tools/shared/usageMerge";
import {
  enumerateDays,
  enumerateHourStarts,
  formatCount,
  formatDayShort,
  formatDateTimeShort,
  formatHourShort,
  formatPercent,
  formatTokens,
  formatUsd,
  formatUsageCost,
} from "@t3tools/shared/usageFormat";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, RefreshControl, ScrollView, View } from "react-native";
import Animated, { Easing, FadeIn, LinearTransition, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { environmentPresentations } from "../../state/presentation";
import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import { SettingsSection } from "../settings/components/SettingsSection";
import { shareUsageReport } from "./shareUsageReport";
import { UsageDailyChart } from "./UsageDailyChart";
import { toggleUsageEnvironment } from "./usageEnvironmentSelection";
import { useRefreshLimits } from "./UsageLimitsSection";
import { UsageLimitsSection } from "./UsageLimitsPooled";
import { ControlPillMenu } from "../../components/ControlPill";
import { SymbolView } from "../../components/AppSymbol";
import type { UsageChartMetric } from "./usageChartData";
import {
  PROVIDER_LABEL,
  PROVIDER_ORDER,
  providersOnUsageScreen,
  usageKindForDriver,
  useProviderColors,
} from "./usageProviders";
import {
  assessSpendBudget,
  calculateUsageVelocity,
  usageComparisonCoverage,
  type BudgetAssessment,
  type UsageVelocityMetrics,
} from "./usageVelocity";

import {
  makeUsageWindow,
  usageWindowOption,
  WINDOW_OPTIONS,
  type UsageWindowPreset,
} from "./usageWindows";

type UsageTab = "usage" | "limits";
const TAB_OPTIONS = [
  { value: "usage", label: "Usage" },
  { value: "limits", label: "Limits" },
] as const satisfies readonly { value: UsageTab; label: string }[];

const METRIC_OPTIONS = [
  { value: "cost", label: "Cost" },
  { value: "tokens", label: "Tokens" },
] as const satisfies readonly { value: UsageChartMetric; label: string }[];

const CHART_HEIGHT = 180;

/**
 * Two tabs over one screen. Usage is the transcript-derived spend for a
 * period; Limits is the live subscription quota, which has no period. Both
 * pull to refresh, each refreshing its own data.
 */
export function UsageRouteScreen() {
  const navigation = useNavigation();
  const exportSourceIdentifier = useId();
  const exportController = useRef<AbortController | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => () => exportController.current?.abort(), []);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const selectedProvider = AsyncResult.isSuccess(preferences)
    ? (preferences.value.usageProvider ?? null)
    : null;
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<UsageTab>("usage");
  const [windowSelection, setWindowSelection] = useState(() => ({
    preset: "30d" as UsageWindowPreset,
    window: makeUsageWindow("30d"),
  }));
  const [metric, setMetric] = useState<UsageChartMetric>("cost");
  const { preset: windowPreset, window } = windowSelection;
  const isHourlyWindow = usageWindowOption(windowPreset).resolution === "hour";
  const [selectedEnvironmentIds, setSelectedEnvironmentIds] =
    useState<ReadonlySet<EnvironmentId> | null>(null);
  const { merged, environments, selectedEnvironments, isPending, refresh } = useUsage(
    window,
    selectedEnvironmentIds,
    selectedProvider,
  );
  const limits = useRefreshLimits(selectedEnvironmentIds);
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);

  const connectedProviders = useMemo(() => {
    const set = new Set<UsageProviderKind>();
    for (const [id, pres] of presentations) {
      if (selectedEnvironmentIds !== null && !selectedEnvironmentIds.has(id)) continue;
      for (const p of pres.serverConfig?.providers ?? []) {
        const kind = usageKindForDriver(p.driver);
        if (kind) {
          if (p.enabled || p.installed || p.status === "ready" || isProviderAvailable(p)) {
            set.add(kind);
          }
        }
      }
    }
    return Array.from(set);
  }, [presentations, selectedEnvironmentIds]);

  const sources = useMemo(
    () =>
      selectedEnvironments.flatMap((environment) =>
        (environment.summary?.sources ?? []).map((source) => ({
          provider: source.fingerprint.provider,
          status: source.status,
        })),
      ),
    [selectedEnvironments],
  );

  const availableProviders = useMemo(
    () => providersOnUsageScreen(merged.providers, sources, connectedProviders),
    [merged.providers, sources, connectedProviders],
  );

  const listedProviders = selectedProvider === null ? availableProviders : [selectedProvider];

  const exportReport = (format: "json" | "csv") => {
    if (exportController.current) return;
    const request = new AbortController();
    exportController.current = request;
    setExporting(true);
    const windowLabel =
      windowPreset === "all"
        ? "All recorded activity"
        : isHourlyWindow && window.sinceTime !== undefined && window.untilTime !== undefined
          ? `${formatDateTimeShort(window.sinceTime, window.timeZone)} to ${formatDateTimeShort(window.untilTime, window.timeZone)}`
          : `${formatDayShort(window.sinceDay)} to ${formatDayShort(window.untilDay)}`;
    void shareUsageReport({
      format,
      signal: request.signal,
      sourceIdentifier: exportSourceIdentifier,
      report: {
        coverageIncomplete: comparisonCoverage !== "complete",
        merged,
        window,
        windowLabel,
        metric,
        exportedAt: new Date().toISOString(),
        selectedProvider,
        selectedEnvironmentIds:
          selectedEnvironmentIds === null ? null : [...selectedEnvironmentIds],
        providers: listedProviders.map((provider) => ({
          provider,
          label: PROVIDER_LABEL[provider],
        })),
      },
    })
      .catch((error: unknown) => {
        if (!request.signal.aborted)
          Alert.alert(
            "Could not export usage",
            error instanceof Error ? error.message : "Try again.",
          );
      })
      .finally(() => {
        if (exportController.current === request) {
          exportController.current = null;
          if (!request.signal.aborted) setExporting(false);
        }
      });
  };

  const days = useMemo(
    () =>
      windowPreset === "all"
        ? merged.daily.map((period) => period.day)
        : enumerateDays(window.sinceDay, window.untilDay),
    [merged.daily, window.sinceDay, window.untilDay, windowPreset],
  );
  const chartDays = useMemo(
    () =>
      isHourlyWindow && window.sinceTime !== undefined && window.untilTime !== undefined
        ? enumerateHourStarts(window.sinceTime, window.untilTime)
        : days,
    [days, isHourlyWindow, window.sinceTime, window.untilTime],
  );
  const chartTotals = useMemo(
    (): readonly DailyTotals[] =>
      isHourlyWindow
        ? merged.hourly.map((hour) => ({
            day: hour.hourStart,
            costUsd: hour.costUsd,
            totalTokens: hour.totalTokens,
            byProvider: hour.byProvider,
          }))
        : merged.daily,
    [isHourlyWindow, merged.daily, merged.hourly],
  );

  const velocity = useMemo(
    () =>
      calculateUsageVelocity({
        costUsd: merged.costUsd,
        totalTokens: merged.totalTokens,
        window,
        allHistory: windowPreset === "all",
        observedDays: days,
      }),
    [days, window, windowPreset, merged.costUsd, merged.totalTokens],
  );

  const monthlyBudgetUsd = AsyncResult.isSuccess(preferences)
    ? (preferences.value.monthlyBudgetUsd ?? null)
    : null;

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

  const [refreshingUsage, setRefreshingUsage] = useState(false);
  const refreshingRef = useRef(false);
  const showingLimits = tab === "limits";
  const selectWindow = (preset: UsageWindowPreset) => {
    setWindowSelection({
      preset,
      window: makeUsageWindow(preset),
    });
  };
  const refreshWindow = () => {
    if (refreshingRef.current) return;
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
    setRefreshingUsage(true);
    void refresh(nextWindow).finally(() => {
      refreshingRef.current = false;
      setRefreshingUsage(false);
    });
  };

  const showEnvironmentFilter = environments.length > 0 || selectedEnvironmentIds !== null;
  const hasLoadingEnvironments = selectedEnvironments.some(isUsageLoading);
  const filterAccessibilityLabel = hasLoadingEnvironments
    ? "Filter usage environments, some environments are loading"
    : "Filter usage environments";
  const filterIcon =
    selectedEnvironmentIds === null
      ? "line.3.horizontal.decrease"
      : "line.3.horizontal.decrease.circle.fill";
  const environmentActions = useMemo(
    () => [
      {
        id: "all",
        title: "All environments",
        subtitle: undefined,
        state: selectedEnvironmentIds === null ? ("on" as const) : ("off" as const),
      },
      ...environments.map((environment) => ({
        id: environment.environmentId,
        title: environment.label,
        subtitle: usageEnvironmentStatus(environment),
        state:
          selectedEnvironmentIds === null || selectedEnvironmentIds.has(environment.environmentId)
            ? ("on" as const)
            : ("off" as const),
      })),
    ],
    [environments, selectedEnvironmentIds],
  );
  const selectEnvironment = useCallback(
    (value: string) => {
      if (value === "all") {
        setSelectedEnvironmentIds(null);
        return;
      }
      const id = EnvironmentId.make(value);
      setSelectedEnvironmentIds((selected) => toggleUsageEnvironment(selected, environments, id));
    },
    [environments],
  );
  const environmentFilter = useMemo(
    () =>
      showEnvironmentFilter ? (
        <ControlPillMenu
          accessible
          accessibilityRole="button"
          accessibilityLabel={filterAccessibilityLabel}
          title="Environments"
          actions={environmentActions}
          onPressAction={({ nativeEvent }) => selectEnvironment(nativeEvent.event)}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={filterAccessibilityLabel}
            className={cn(
              "items-center justify-center rounded-full",
              Platform.OS === "ios" ? "size-[28px]" : "size-[44px]",
            )}
          >
            <SymbolView name={filterIcon} size={22} tintColorClassName="accent-icon" />
            {hasLoadingEnvironments ? (
              <View
                pointerEvents="none"
                className="absolute -right-[2px] -top-[2px] size-[9px] rounded-full bg-amber-500"
              />
            ) : null}
          </Pressable>
        </ControlPillMenu>
      ) : null,
    [
      showEnvironmentFilter,
      environmentActions,
      selectEnvironment,
      filterAccessibilityLabel,
      filterIcon,
      hasLoadingEnvironments,
    ],
  );

  useLayoutEffect(() => {
    if (Platform.OS === "ios") {
      navigation.setOptions({ headerRight: () => environmentFilter });
    }
  }, [navigation, environmentFilter]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader
            title="Usage"
            onBack={() => navigation.goBack()}
            trailing={environmentFilter}
          />
        </>
      ) : null}
      <ScrollView
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        refreshControl={
          <RefreshControl
            refreshing={showingLimits ? limits.refreshing : refreshingUsage}
            onRefresh={showingLimits ? () => void limits.refresh() : refreshWindow}
          />
        }
      >
        <SegmentedControl options={TAB_OPTIONS} selected={tab} onSelect={setTab} role="tab" />

        <Animated.View
          key={tab}
          entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
          className="gap-6"
        >
          {showingLimits ? (
            <UsageLimitsSection
              now={limits.now}
              failedLabels={limits.failedLabels}
              selectedEnvironmentIds={selectedEnvironmentIds}
            />
          ) : (
            <>
              {/* Period and metric together: neither applies to Limits, and
                both change every number below, so they share one bar. */}
              <View className="flex-row items-center gap-3">
                <ControlPillMenu
                  title="Usage period"
                  actions={WINDOW_OPTIONS.map((option) => ({
                    id: option.value,
                    title: option.accessibilityLabel,
                    state: option.value === windowPreset ? ("on" as const) : ("off" as const),
                  }))}
                  onPressAction={({ nativeEvent }) =>
                    selectWindow(nativeEvent.event as UsageWindowPreset)
                  }
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Usage period, ${usageWindowOption(windowPreset).accessibilityLabel}`}
                    className="h-9 flex-1 items-center justify-center rounded-full bg-foreground/5 px-3"
                  >
                    <Text className="text-sm font-medium text-foreground">
                      {usageWindowOption(windowPreset).accessibilityLabel}
                    </Text>
                  </Pressable>
                </ControlPillMenu>
                <SegmentedControl
                  options={METRIC_OPTIONS}
                  selected={metric}
                  onSelect={setMetric}
                  size="compact"
                  className="w-36"
                />
              </View>
              <View className="flex-row items-center gap-2">
                <View className="min-w-0 flex-1">
                  <ControlPillMenu
                    title="Usage harness"
                    actions={[
                      {
                        id: "all",
                        title: "All harnesses",
                        state: selectedProvider === null ? "on" : "off",
                      },
                      ...PROVIDER_ORDER.map((provider) => ({
                        id: provider,
                        title: PROVIDER_LABEL[provider],
                        state: selectedProvider === provider ? ("on" as const) : ("off" as const),
                      })),
                    ]}
                    onPressAction={({ nativeEvent }) => {
                      const provider = PROVIDER_ORDER.find((value) => value === nativeEvent.event);
                      if (provider !== undefined || nativeEvent.event === "all")
                        savePreferences({ usageProvider: provider ?? null });
                    }}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Filter usage harness, ${selectedProvider === null ? "All harnesses" : PROVIDER_LABEL[selectedProvider]}`}
                      className="h-9 flex-row items-center justify-between rounded-full bg-foreground/5 px-3"
                    >
                      <Text className="text-xs font-medium text-foreground truncate">
                        {selectedProvider === null
                          ? "All harnesses"
                          : PROVIDER_LABEL[selectedProvider]}
                      </Text>
                      <SymbolView name="chevron.down" size={10} tintColorClassName="accent-icon" />
                    </Pressable>
                  </ControlPillMenu>
                </View>
                <ControlPillMenu
                  title="30-day API-equivalent cost target"
                  actions={[
                    {
                      id: "none",
                      title: "No target",
                      state: monthlyBudgetUsd === null ? "on" : "off",
                    },
                    {
                      id: "25",
                      title: "$25 / 30 days",
                      state: monthlyBudgetUsd === 25 ? "on" : "off",
                    },
                    {
                      id: "50",
                      title: "$50 / 30 days",
                      state: monthlyBudgetUsd === 50 ? "on" : "off",
                    },
                    {
                      id: "100",
                      title: "$100 / 30 days",
                      state: monthlyBudgetUsd === 100 ? "on" : "off",
                    },
                    {
                      id: "250",
                      title: "$250 / 30 days",
                      state: monthlyBudgetUsd === 250 ? "on" : "off",
                    },
                    {
                      id: "500",
                      title: "$500 / 30 days",
                      state: monthlyBudgetUsd === 500 ? "on" : "off",
                    },
                  ]}
                  onPressAction={({ nativeEvent }) => {
                    if (nativeEvent.event === "none") {
                      savePreferences({ monthlyBudgetUsd: null });
                    } else {
                      const amount = Number(nativeEvent.event);
                      if (Number.isFinite(amount) && amount > 0) {
                        savePreferences({ monthlyBudgetUsd: amount });
                      }
                    }
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`30-day API-equivalent cost target, ${monthlyBudgetUsd ? `$${monthlyBudgetUsd}/30d` : "Target"}`}
                    className="h-9 flex-row items-center gap-1.5 rounded-full bg-foreground/5 px-3"
                  >
                    <Text className="text-xs font-medium text-foreground">
                      {monthlyBudgetUsd ? `$${monthlyBudgetUsd}/30d` : "Target"}
                    </Text>
                    <SymbolView name="chevron.down" size={10} tintColorClassName="accent-icon" />
                  </Pressable>
                </ControlPillMenu>
                <ControlPillMenu
                  title="Export usage report"
                  actions={[
                    {
                      id: "json",
                      title: "Export as JSON",
                      attributes: {
                        disabled: exporting || isPending || selectedEnvironments.length === 0,
                      },
                    },
                    {
                      id: "csv",
                      title: "Export as CSV",
                      attributes: {
                        disabled: exporting || isPending || selectedEnvironments.length === 0,
                      },
                    },
                  ]}
                  onPressAction={({ nativeEvent }) => {
                    if (nativeEvent.event === "json" || nativeEvent.event === "csv")
                      exportReport(nativeEvent.event);
                  }}
                >
                  <Pressable
                    nativeID={exportSourceIdentifier}
                    disabled={exporting || isPending || selectedEnvironments.length === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Export usage report"
                    accessibilityState={{
                      busy: exporting,
                      disabled: exporting || isPending || selectedEnvironments.length === 0,
                    }}
                    className="h-9 flex-row items-center justify-center gap-2 rounded-full bg-foreground/5 px-3"
                  >
                    <SymbolView
                      name="square.and.arrow.up"
                      size={14}
                      tintColorClassName="accent-icon"
                    />
                    <Text className="text-sm font-medium text-foreground">
                      {exporting ? "Opening share sheet…" : "Export"}
                    </Text>
                  </Pressable>
                </ControlPillMenu>
              </View>
              {merged.duplicateSources.length > 0 ? (
                <Text className="text-sm text-foreground-muted">
                  Counted once across environments sharing a transcript directory:{" "}
                  {merged.duplicateSources.join(", ")}
                </Text>
              ) : null}
              {isPending ? (
                <Text className="py-16 text-center text-base text-foreground-muted">
                  Scanning provider transcripts…
                </Text>
              ) : selectedEnvironments.length === 0 ? (
                <Text className="py-16 text-center text-base text-foreground-muted">
                  {environments.length === 0
                    ? "Connect an environment to see usage."
                    : "Select an environment to see usage."}
                </Text>
              ) : (
                <>
                  <ChartCard
                    incomplete={comparisonCoverage !== "complete"}
                    merged={merged}
                    days={chartDays}
                    daily={chartTotals}
                    metric={metric}
                    sinceDay={window.sinceDay}
                    untilDay={window.untilDay}
                    isPast24Hours={isHourlyWindow}
                    timeZone={window.timeZone}
                    listedProviders={listedProviders}
                  />
                  <ProviderSection
                    merged={merged}
                    metric={metric}
                    listedProviders={listedProviders}
                  />
                  <TotalsSection
                    merged={merged}
                    isPast24Hours={isHourlyWindow}
                    velocity={velocity}
                    budgetAssessment={budgetAssessment}
                  />
                  <ModelsSection merged={merged} metric={metric} />
                </>
              )}
            </>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function SegmentedControl<Value extends number | string>(props: {
  readonly options: readonly {
    readonly value: Value;
    readonly label: string;
    readonly accessibilityLabel?: string;
  }[];
  readonly selected: Value;
  readonly onSelect: (value: Value) => void;
  /** The tab bar is full height; filters under it are shorter so it stays primary. */
  readonly size?: "default" | "compact";
  /** "tab" for the view switcher; filters stay plain buttons. */
  readonly role?: "tab" | "button";
  readonly className?: string;
}) {
  const compact = props.size === "compact";
  return (
    <View
      accessible={false}
      className={cn(
        "flex-row overflow-hidden rounded-full border-continuous bg-card",
        props.className,
      )}
    >
      <Animated.View
        pointerEvents="none"
        layout={LinearTransition.duration(200)
          .easing(Easing.out(Easing.cubic))
          .reduceMotion(ReduceMotion.System)}
        className="absolute bottom-0 top-0 rounded-full bg-subtle-strong"
        style={{
          width: `${100 / props.options.length}%`,
          start: `${
            (Math.max(
              0,
              props.options.findIndex((option) => option.value === props.selected),
            ) *
              100) /
            props.options.length
          }%`,
        }}
      />
      {props.options.map((option) => {
        const active = option.value === props.selected;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole={Platform.OS === "ios" ? "button" : (props.role ?? "button")}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected: active }}
            onPress={() => props.onSelect(option.value)}
            className={cn(
              "flex-1 items-center justify-center rounded-full",
              compact ? "h-9" : "h-11",
            )}
          >
            <Text
              className={cn(
                compact ? "text-xs" : "text-sm",
                active ? "font-t3-medium text-foreground" : "text-foreground-muted",
              )}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Headline figure, the animated daily chart, and its legend, in one card. */
function ChartCard(props: {
  readonly incomplete: boolean;
  readonly merged: MergedUsage;
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly metric: UsageChartMetric;
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly isPast24Hours: boolean;
  readonly timeZone: string;
  readonly listedProviders: readonly UsageProviderKind[];
}) {
  const { merged, metric, listedProviders } = props;
  const colors = useProviderColors();
  const hasActivity = props.daily.some((period) => period.totalTokens > 0);

  return (
    <View className="gap-4 rounded-[24px] border-continuous bg-card p-4">
      <View className="gap-0.5">
        <Text className="text-sm text-foreground-muted">
          {metric === "cost"
            ? props.incomplete
              ? "Known cost only"
              : "API-equivalent cost"
            : "Processed tokens"}
        </Text>
        <Text className="text-4xl font-t3-bold tabular-nums text-foreground">
          {metric === "cost" ? `${formatUsd(merged.costUsd)}*` : formatTokens(merged.totalTokens)}
        </Text>
        <Text className="text-sm text-foreground-muted">
          {metric === "cost"
            ? props.incomplete
              ? "* Incomplete estimate; actual usage may be higher"
              : "* API-equivalent estimate, not billed"
            : `Across ${formatCount(merged.sessions)} sessions`}
        </Text>
      </View>

      {hasActivity ? (
        <UsageDailyChart
          days={props.days}
          daily={props.daily}
          metric={metric}
          height={CHART_HEIGHT}
        />
      ) : (
        <View style={{ height: CHART_HEIGHT }} className="items-center justify-center">
          <Text className="text-base text-foreground-muted">No activity in this window.</Text>
        </View>
      )}

      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-foreground-tertiary">
          {props.isPast24Hours
            ? formatHourShort(props.days[0] ?? "", props.timeZone)
            : formatDayShort(props.sinceDay)}
        </Text>
        <View className="flex-row items-center gap-4">
          {listedProviders.map((provider) => (
            <View key={provider} className="flex-row items-center gap-1.5">
              <View className="size-2 rounded-full" style={{ backgroundColor: colors[provider] }} />
              <Text className="text-xs text-foreground-muted">{PROVIDER_LABEL[provider]}</Text>
            </View>
          ))}
        </View>
        <Text className="text-xs text-foreground-tertiary">
          {props.isPast24Hours
            ? formatHourShort(props.days[props.days.length - 1] ?? "", props.timeZone)
            : formatDayShort(props.untilDay)}
        </Text>
      </View>
    </View>
  );
}

function ProviderSection(props: {
  readonly merged: MergedUsage;
  readonly metric: UsageChartMetric;
  readonly listedProviders: readonly UsageProviderKind[];
}) {
  const { merged, metric, listedProviders } = props;
  const colors = useProviderColors();
  if (listedProviders.length === 0) return null;

  const existingMap = new Map(merged.providers.map((p) => [p.provider, p]));
  const rows = listedProviders.map((provider) => {
    const existing = existingMap.get(provider);
    return {
      provider,
      costUsd: existing?.costUsd ?? 0,
      records: existing?.records ?? 0,
      unpricedRecords: existing?.unpricedRecords ?? 0,
      totalTokens: existing?.totalTokens ?? 0,
      costShare: existing?.costShare ?? 0,
      tokenShare: existing?.tokenShare ?? 0,
    };
  });

  // Ranked by whatever the toggle is showing, so the rows always descend.
  // .sort() on a copy, not .toSorted(): Hermes doesn't ship the ES2023 method.
  const ordered = [...rows].sort((a, b) =>
    metric === "cost" ? b.costUsd - a.costUsd : b.totalTokens - a.totalTokens,
  );

  return (
    <SettingsSection title="Providers" card>
      {ordered.map((provider, index) => {
        const share = metric === "cost" ? provider.costShare : provider.tokenShare;
        return (
          <View
            key={provider.provider}
            className={index === 0 ? "gap-2 p-4" : "gap-2 border-t border-border-subtle p-4"}
          >
            <View className="flex-row items-baseline justify-between gap-3">
              <View className="flex-row items-center gap-2">
                <View
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: colors[provider.provider] }}
                />
                <Text className="text-lg text-foreground">{PROVIDER_LABEL[provider.provider]}</Text>
              </View>
              <Text className="text-lg tabular-nums text-foreground">
                {metric === "cost"
                  ? formatUsageCost(provider.costUsd, provider.unpricedRecords, provider.records)
                  : formatTokens(provider.totalTokens)}
              </Text>
            </View>
            <View className="h-1 flex-row overflow-hidden rounded-full bg-subtle">
              <View
                className="h-full rounded-full"
                style={{ flex: Math.max(share, 0.001), backgroundColor: colors[provider.provider] }}
              />
              <View style={{ flex: Math.max(1 - share, 0) }} />
            </View>
            <Text className="text-sm text-foreground-muted">
              {metric === "cost"
                ? `${formatPercent(share)} of cost · ${formatTokens(provider.totalTokens)} tokens`
                : `${formatPercent(share)} of tokens · ${formatUsageCost(provider.costUsd, provider.unpricedRecords, provider.records)}`}
            </Text>
          </View>
        );
      })}
    </SettingsSection>
  );
}

function TotalsSection(props: {
  readonly merged: MergedUsage;
  readonly isPast24Hours: boolean;
  readonly velocity: UsageVelocityMetrics | null;
  readonly budgetAssessment: BudgetAssessment | null;
}) {
  const { merged, velocity, budgetAssessment } = props;
  const activePeriods = (props.isPast24Hours ? merged.hourly : merged.daily).filter(
    (period) => period.totalTokens > 0,
  ).length;
  const periodAverage = activePeriods === 0 ? 0 : merged.totalTokens / activePeriods;
  const observedInput = merged.uncachedInputTokens + merged.cachedInputTokens;
  const cachedShare = observedInput === 0 ? 0 : merged.cachedInputTokens / observedInput;

  return (
    <SettingsSection title="Totals" card>
      <View className="flex-row flex-wrap">
        <MetricCell
          label="Processed tokens"
          value={formatTokens(merged.totalTokens)}
          detail={`${formatTokens(periodAverage)} per active ${props.isPast24Hours ? "hour" : "day"}`}
        />
        <MetricCell
          label="Cache savings"
          value={formatUsd(merged.costQuality.cacheSavingsUsd)}
          detail={
            merged.costUsd > 0
              ? `${(merged.costQuality.cacheSavingsUsd / merged.costUsd).toFixed(1)}x the raw cost`
              : "vs full input rates"
          }
        />
        <MetricCell
          label="Cached input"
          value={formatTokens(merged.cachedInputTokens)}
          detail={`${formatPercent(cachedShare)} of observed input`}
        />
        <MetricCell
          label="Uncached input"
          value={formatTokens(merged.uncachedInputTokens)}
          detail={`${formatTokens(merged.cacheCreationTokens)} cache writes`}
        />
        <MetricCell
          label="Output"
          value={formatTokens(merged.outputTokens)}
          detail={`incl. ${formatTokens(merged.reasoningTokens)} reasoning`}
        />
        <MetricCell
          label="Unpriced"
          value={formatPercent(merged.costQuality.unpricedShare)}
          detail="of records, excluded from cost"
        />
      </View>
      {budgetAssessment ? (
        <View className="gap-2.5 border-t border-border-subtle p-4">
          <View className="flex-row items-center justify-between">
            <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
              <View
                className={cn(
                  "size-2 rounded-full",
                  budgetAssessment.status === "exceeded"
                    ? "bg-red-500"
                    : budgetAssessment.status === "warning" || budgetAssessment.status === "unknown"
                      ? "bg-amber-500"
                      : "bg-emerald-500",
                )}
              />
              <Text className="flex-1 text-xs font-t3-medium text-foreground">
                30-day API-equivalent target
              </Text>
            </View>
            <View
              className={cn(
                "rounded-full px-2 py-0.5",
                budgetAssessment.status === "exceeded"
                  ? "bg-red-500/15"
                  : budgetAssessment.status === "warning" || budgetAssessment.status === "unknown"
                    ? "bg-amber-500/15"
                    : "bg-emerald-500/15",
              )}
            >
              <Text
                className={cn(
                  "text-[10px] font-t3-bold",
                  budgetAssessment.status === "exceeded"
                    ? "text-red-500"
                    : budgetAssessment.status === "warning" || budgetAssessment.status === "unknown"
                      ? "text-amber-500"
                      : "text-emerald-500",
                )}
              >
                {budgetAssessment.status === "unknown"
                  ? "Unknown"
                  : `${budgetAssessment.percentOfBudget}%`}
              </Text>
            </View>
          </View>
          {budgetAssessment.status !== "unknown" ? (
            <View className="h-1.5 flex-row overflow-hidden rounded-full bg-subtle">
              <View
                className={cn(
                  "h-full rounded-full",
                  budgetAssessment.status === "exceeded"
                    ? "bg-red-500"
                    : budgetAssessment.status === "warning"
                      ? "bg-amber-500"
                      : "bg-emerald-500",
                )}
                style={{ flex: Math.min(budgetAssessment.percentOfBudget, 100) }}
              />
              <View style={{ flex: Math.max(100 - budgetAssessment.percentOfBudget, 0) }} />
            </View>
          ) : null}
          <View className="flex-row flex-wrap items-baseline justify-between gap-1 pt-0.5">
            <Text className="text-xs text-foreground-muted">{budgetAssessment.label}</Text>
            <Text className="text-xs font-t3-medium tabular-nums text-foreground">
              {formatUsd(budgetAssessment.thirtyDayCostUsd)} /{" "}
              {formatUsd(budgetAssessment.monthlyBudgetUsd)}
            </Text>
          </View>
        </View>
      ) : null}
      <View className="gap-2 border-t border-border-subtle p-4">
        <Text className="text-xs font-t3-medium text-foreground">Recorded usage rate</Text>
        <Text className="text-xs text-foreground-tertiary">
          Recorded history including quiet periods. API-equivalent cost, not a subscription bill or
          forecast. All uses the first through last recorded day.
        </Text>
        <View className="flex-row flex-wrap items-center justify-between gap-y-2">
          <View className="gap-0.5">
            <Text className="text-xs text-foreground-muted">API-equivalent average</Text>
            <Text className="text-sm font-t3-medium tabular-nums text-foreground">
              {velocity ? formatUsd(velocity.dailyCostVelocity) : "—"}/day
            </Text>
          </View>
          <View className="gap-0.5">
            <Text className="text-xs text-foreground-muted">30 days at this rate</Text>
            <Text className="text-sm font-t3-medium tabular-nums text-foreground">
              {velocity ? formatUsd(velocity.thirtyDayCostUsd) : "—"}
            </Text>
          </View>
          <View className="gap-0.5">
            <Text className="text-xs text-foreground-muted">Daily token average</Text>
            <Text className="text-sm font-t3-medium tabular-nums text-foreground">
              {velocity ? formatTokens(velocity.dailyTokenVelocity) : "—"}/day
            </Text>
          </View>
        </View>
      </View>
    </SettingsSection>
  );
}

function MetricCell(props: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <View className="w-1/2 gap-0.5 p-4">
      <Text className="text-sm text-foreground-muted">{props.label}</Text>
      <Text className="text-xl font-t3-medium tabular-nums text-foreground">{props.value}</Text>
      <Text className="text-xs text-foreground-tertiary">{props.detail}</Text>
    </View>
  );
}

function ModelsSection(props: { readonly merged: MergedUsage; readonly metric: UsageChartMetric }) {
  const { merged, metric } = props;
  const colors = useProviderColors();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const [needsPricing, setNeedsPricing] = useState(false);
  const models = selectUsageModels(merged.models, { metric, query, needsPricing });
  if (merged.models.length === 0) return null;

  return (
    <SettingsSection title="By model" card>
      <View className="gap-2 p-4">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: needsPricing }}
          onPress={() => {
            setNeedsPricing((current) => !current);
            setLimit(20);
          }}
          className="min-h-11 justify-center rounded-md border border-border-subtle px-3"
        >
          <Text className="text-sm text-foreground">
            {needsPricing ? "Showing models needing pricing · Show all" : "Needs pricing"}
          </Text>
        </Pressable>
        {needsPricing ? (
          <Text className="text-xs text-foreground-muted">
            Unpriced records are excluded from known cost. Tokens include all records for each
            model; partial models also contain priced records.
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel="Search usage models"
          placeholder="Search model or provider"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setLimit(20);
          }}
        />
        <Text className="text-xs text-foreground-tertiary">
          {models.length} matching {models.length === 1 ? "model" : "models"} · ranked by {metric}
        </Text>
      </View>
      {models.length === 0 ? (
        <Text className="p-4 text-sm text-foreground-muted">
          No matching models. Clear the search to see all models.
        </Text>
      ) : null}
      {models.slice(0, limit).map((model) => (
        <View
          key={`${model.provider}:${model.model}`}
          className="flex-row items-center gap-3 border-t border-border-subtle p-4"
        >
          <View
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: colors[model.provider] }}
          />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-base text-foreground" numberOfLines={1}>
              {model.model}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {PROVIDER_LABEL[model.provider]} · {formatPercent(model.costShare)} of cost ·{" "}
              {formatTokens(model.totalTokens)} tokens
            </Text>
            {(model.unpricedRecords ?? 0) > 0 ? (
              <Text className="text-xs text-foreground-muted">
                {formatCount(model.unpricedRecords ?? 0)} of {formatCount(model.records)} records
                unpriced
              </Text>
            ) : null}
          </View>
          <Text className="text-base tabular-nums text-foreground">
            {formatUsageCost(model.costUsd, model.unpricedRecords, model.records)}
          </Text>
        </View>
      ))}
      {models.length > limit ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setLimit((current) => current + 20)}
          className="border-t border-border-subtle p-4"
        >
          <Text className="text-sm text-foreground">
            Show more ({models.length - limit} remaining)
          </Text>
        </Pressable>
      ) : limit > 20 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setLimit(20)}
          className="border-t border-border-subtle p-4"
        >
          <Text className="text-sm text-foreground">Show fewer</Text>
        </Pressable>
      ) : null}
    </SettingsSection>
  );
}

/**
 * Says plainly when the totals are incomplete: an environment still answering,
 * one that failed, or one whose transcripts another environment already
 * reported.
 */
function isUsageLoading(environment: EnvironmentUsageStatus) {
  return environment.isPending || (environment.summary === null && environment.error === null);
}

function usageEnvironmentStatus(environment: EnvironmentUsageStatus): string {
  if (
    environment.summary &&
    !isCompatibleUsageContractVersion(environment.summary.contractVersion, USAGE_CONTRACT_VERSION)
  ) {
    return "Older server · excluded from usage totals";
  }
  if (!environment.isConnected)
    return environment.summary ? "Disconnected · showing saved usage" : "Waiting for connection…";
  if (environment.error)
    return environment.summary ? "Usage unavailable · showing saved totals" : "Usage unavailable";
  if (isUsageLoading(environment))
    return environment.summary ? "Updating usage…" : "Loading usage…";
  if (
    environment.summary?.sources.some(
      (source) => source.status === "partial" || source.status === "failed",
    )
  )
    return "Incomplete history · usage may be higher";
  return "Usage up to date";
}
