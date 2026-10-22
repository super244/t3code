/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=45m; seat=codex; date=2026-10-21 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=40m; seat=codex; date=2026-10-20 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=9m; seat=codex; date=2026-10-19 */
import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import type {
  RaceHistoryRecord,
  RaceHistoryOutcome,
  RaceTaskKind,
  ThreadId,
} from "@t3tools/contracts";
import {
  buildRaceLeaderboard,
  buildRaceMatchups,
  raceContainsPair,
  type RaceMatchup,
  queryRaceHistory,
  RACE_TASK_KIND_LABELS,
} from "@t3tools/shared/raceHistory";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ControlPillMenu } from "../../components/ControlPill";
import { cn } from "../../lib/cn";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSnapshotAtom } from "../../state/shell";
import { raceHistoryEnvironment } from "../../state/raceHistory";
import { shareRaceHistory } from "./shareRaceHistory";

const EMPTY_RECORDS: ReadonlyArray<RaceHistoryRecord> = [];
const PAGE_SIZE = 20;
const cost = (value: number | null) =>
  value === null
    ? "Unreported"
    : value === 0
      ? "$0"
      : value < 0.0001
        ? "<$0.0001"
        : `$${value.toFixed(4)}`;
const pairedDelta = (value: number | null, unit: "time" | "cost") => {
  if (value === null) return "Unreported";
  const amount =
    unit === "time" ? `${(Math.abs(value) / 1000).toFixed(1)}s` : `$${Math.abs(value).toFixed(4)}`;
  return `${value < 0 ? "−" : value > 0 ? "+" : ""}${amount}`;
};
const elapsed = (value: number | null) =>
  value === null ? "Unreported" : `${Math.round(value / 1000)}s`;

function Chip({
  label,
  selected = false,
  disabled = false,
  onPress,
}: {
  readonly label: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        "min-h-11 items-center justify-center rounded-xl px-3 py-2 active:opacity-60",
        selected ? "bg-primary" : "bg-subtle",
        disabled && "opacity-40",
      )}
    >
      <Text
        className={cn(
          "text-sm font-t3-medium",
          selected ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function SettingsRaceHistoryRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    environments.find((environment) => environment.environmentId === selectedId) ??
    environments.find((environment) => environment.connection.phase === "connected") ??
    environments[0];
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Race history" onBack={() => navigation.goBack()} />
        </>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <Text className="text-sm leading-normal text-foreground-muted">
          Review the races kept on a connected computer. Wins reflect what you kept; prices reflect
          what providers reported.
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2"
        >
          {environments.map((environment) => (
            <Chip
              key={environment.environmentId}
              label={`${environment.label}${environment.connection.phase !== "connected" ? " · offline" : ""}`}
              selected={selected?.environmentId === environment.environmentId}
              onPress={() => setSelectedId(environment.environmentId)}
            />
          ))}
        </ScrollView>
        {!selected ? (
          <Text className="py-8 text-sm text-foreground-muted">
            Connect a computer to read its saved race history.
          </Text>
        ) : selected.connection.phase !== "connected" ? (
          <Text className="py-8 text-sm text-foreground-muted">
            {selected.label} is disconnected. Its history is unavailable until it reconnects.
          </Text>
        ) : (
          <EnvironmentRaceHistory key={selected.environmentId} environment={selected} />
        )}
      </ScrollView>
    </View>
  );
}

function EnvironmentRaceHistory({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  const query = useEnvironmentQuery(
    raceHistoryEnvironment.list({ environmentId: environment.environmentId, input: {} }),
  );
  const navigation = useNavigation();
  const snapshot = useAtomValue(environmentSnapshotAtom(environment.environmentId));
  const availableThreads = useMemo(
    () => new Set((snapshot?.threads ?? []).map((thread) => thread.id)),
    [snapshot?.threads],
  );
  const openThread = (threadId: ThreadId) => {
    if (environment.connection.phase !== "connected" || !availableThreads.has(threadId)) return;
    const params = { environmentId: environment.environmentId, threadId };
    const root = navigation.getParent()?.getParent();
    if (root) root.dispatch(StackActions.popTo("Thread", params));
    else navigation.navigate("Thread", params);
  };
  const records = query.data?.records ?? EMPTY_RECORDS;
  const [pair, setPair] = useState<RaceMatchup | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<RaceTaskKind | "">("");
  const [outcome, setOutcome] = useState<RaceHistoryOutcome | "">("");
  const [project, setProject] = useState("");
  const [after, setAfter] = useState("");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => () => exportController.current?.abort(), []);
  const projects = useMemo(
    () =>
      [
        ...new Map(
          records.map((record) => [record.projectId, record.projectTitle || record.projectId]),
        ).entries(),
      ].toSorted((left, right) => left[1].localeCompare(right[1])),
    [records],
  );
  const scoped = useMemo(
    () =>
      queryRaceHistory(
        records.filter((record) => !project || record.projectId === project),
        {
          query: search,
          ...(kind ? { taskKind: kind } : {}),
          ...(outcome ? { outcome } : {}),
          ...(after ? { after } : {}),
        },
      ).records,
    [records, project, search, kind, outcome, after],
  );
  const filtered = useMemo(
    () => (pair ? scoped.filter((record) => raceContainsPair(record, pair)) : scoped),
    [scoped, pair],
  );
  const matchups = useMemo(() => buildRaceMatchups(scoped), [scoped]);
  const board = useMemo(() => buildRaceLeaderboard(filtered), [filtered]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const canExport = filtered.length > 0 && query.error === null && !query.isPending && !exporting;
  const exportFile = async (
    format: "json" | "csv" | "md",
    selectedRecords: ReadonlyArray<RaceHistoryRecord> = filtered,
  ) => {
    if (!canExport) return;
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    try {
      await shareRaceHistory({
        records: selectedRecords,
        environmentId: environment.environmentId,
        environmentLabel: environment.label,
        filters: {
          pair: pair ? JSON.stringify({ left: pair.left, right: pair.right }) : "",
          search,
          kind,
          outcome,
          project,
          after,
        },
        format,
        signal: controller.signal,
      });
    } catch (error) {
      if (!controller.signal.aborted)
        Alert.alert(
          "Could not share race evidence",
          error instanceof Error ? error.message : "The export failed.",
        );
    } finally {
      if (!controller.signal.aborted) setExporting(false);
      if (exportController.current === controller) exportController.current = null;
    }
  };
  const clear = () => {
    setSearch("");
    setKind("");
    setOutcome("");
    setProject("");
    setAfter("");
    setPage(0);
  };
  return (
    <View className="gap-4">
      <TextInput
        accessibilityLabel="Search race history"
        value={search}
        onChangeText={(value) => {
          setSearch(value);
          setPage(0);
        }}
        maxLength={300}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Search prompts, models, or failures"
        className="min-h-11 rounded-xl bg-subtle px-3 text-sm text-foreground"
      />
      {pair ? (
        <View className="gap-2">
          <Text className="text-xs text-foreground-muted">
            Shared races: {pair.left.label} versus {pair.right.label}
          </Text>
          <Chip
            label="Clear model pair"
            onPress={() => {
              setPair(null);
              setPage(0);
            }}
          />
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <ControlPillMenu
          accessibilityRole="button"
          accessibilityLabel="Filter races by project"
          actions={[
            { id: "all", title: "All projects", state: project ? "off" : "on" },
            ...projects.map(([id, title]) => ({
              id: `project:${id}`,
              title,
              state: project === id ? ("on" as const) : ("off" as const),
            })),
          ]}
          onPressAction={({ nativeEvent }) => {
            setProject(nativeEvent.event === "all" ? "" : nativeEvent.event.slice(8));
            setPage(0);
          }}
        >
          <View className="min-h-11 justify-center rounded-xl bg-subtle px-3">
            <Text className="text-sm text-foreground">
              {projects.find(([id]) => id === project)?.[1] ??
                (project ? "Project unavailable" : "All projects")}{" "}
              ▾
            </Text>
          </View>
        </ControlPillMenu>
        <ControlPillMenu
          accessibilityRole="button"
          accessibilityLabel="Filter races by task kind"
          actions={[
            { id: "all", title: "All task kinds", state: kind ? "off" : "on" },
            ...Object.entries(RACE_TASK_KIND_LABELS).map(([id, title]) => ({
              id,
              title,
              state: kind === id ? ("on" as const) : ("off" as const),
            })),
          ]}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "all") setKind("");
            else if (Object.hasOwn(RACE_TASK_KIND_LABELS, nativeEvent.event))
              setKind(nativeEvent.event as RaceTaskKind);
            setPage(0);
          }}
        >
          <View className="min-h-11 justify-center rounded-xl bg-subtle px-3">
            <Text className="text-sm text-foreground">
              {kind ? RACE_TASK_KIND_LABELS[kind] : "All task kinds"} ▾
            </Text>
          </View>
        </ControlPillMenu>
        <Chip
          label={after ? "Last 30 days" : "All retained time"}
          selected={Boolean(after)}
          onPress={() => {
            setAfter(after ? "" : new Date(Date.now() - 30 * 86_400_000).toISOString());
            setPage(0);
          }}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2"
      >
        {(
          [
            ["", "All outcomes"],
            ["kept", "Kept winner"],
            ["none", "No winner"],
            ["open", "Undecided"],
          ] as const
        ).map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            selected={outcome === value}
            onPress={() => {
              setOutcome(value);
              setPage(0);
            }}
          />
        ))}
      </ScrollView>
      <View className="flex-row flex-wrap items-center gap-2">
        <Chip label="Refresh" disabled={query.isPending} onPress={query.refresh} />
        <Chip label="Clear filters" onPress={clear} />
        <Chip
          label="Export JSON"
          disabled={!canExport}
          onPress={() => {
            void exportFile("json");
          }}
        />
        <Chip
          label="Export CSV"
          disabled={!canExport}
          onPress={() => {
            void exportFile("csv");
          }}
        />
        <Chip
          label="Export Markdown"
          disabled={!canExport}
          onPress={() => {
            void exportFile("md");
          }}
        />
      </View>
      {query.error ? (
        <Text accessibilityRole="alert" className="text-sm text-danger">
          {query.error} Refresh after reconnecting, or update this computer if its server does not
          support Race history.
        </Text>
      ) : null}
      {query.data === null ? (
        <Text className="py-5 text-sm text-foreground-muted">
          {query.isPending
            ? "Reading saved race history…"
            : query.error
              ? "History could not be read."
              : "Waiting for race history…"}
        </Text>
      ) : (
        <>
          <Text className="text-xs text-foreground-muted">
            {filtered.length} matching of {records.length} retained races · up to 500 on{" "}
            {environment.label}. Exports include every match across all pages; unknown prices remain
            unknown.
          </Text>
          <Text className="text-base font-t3-medium text-foreground">Leaderboard</Text>
          {board.slice(0, 10).map((row) => (
            <View key={row.key} className="gap-1 border-b border-border py-3">
              <Text className="text-sm font-t3-medium text-foreground">{row.label}</Text>
              <Text className="text-xs text-foreground-muted">
                {row.wins} kept / {row.decided} decided ·{" "}
                {row.keepRate === null ? "No keep rate" : `${Math.round(row.keepRate * 100)}% kept`}{" "}
                · {row.failures} failed
              </Text>
              <Text className="text-xs text-foreground-muted">
                Median time {elapsed(row.medianMs)} · cost {cost(row.medianCostUsd)} (
                {row.costReports}/{row.races} prices reported)
              </Text>
            </View>
          ))}
          {board.length > 10 ? (
            <Text className="text-xs text-foreground-muted">
              Showing the top 10 agents. Export includes every agent.
            </Text>
          ) : null}
          <Text className="mt-3 text-base font-t3-medium text-foreground">Head-to-head</Text>
          <Text className="text-xs text-foreground-muted">
            Only shared races. Deltas are A minus B; negative means A used less. Repeated harness
            and model entries in one race are excluded. View shared races scopes the leaderboard,
            history and exports.
          </Text>
          {matchups.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              No distinct model pairs in this selection.
            </Text>
          ) : null}
          {matchups.map((row) => (
            <View key={row.key} className="gap-1 border-b border-border py-3">
              <Text className="text-sm font-t3-medium text-foreground">
                A · {row.left.label}
                {"\n"}B · {row.right.label}
              </Text>
              <Text className="text-xs text-foreground-muted">
                {row.races} shared · kept {row.leftWins} / {row.rightWins} · no winner{" "}
                {row.noWinner} · other kept {row.otherWinner} · winner unknown {row.unknownWinner} ·
                open {row.open}
              </Text>
              <Text className="text-xs text-foreground-muted">
                Median time Δ {pairedDelta(row.medianTimeDeltaMs, "time")} ({row.timePairs} pairs) ·
                cost Δ {pairedDelta(row.medianCostDeltaUsd, "cost")} ({row.costPairs} pairs)
              </Text>
              <Chip
                label={`View shared races: ${row.left.label} versus ${row.right.label}`}
                selected={pair?.key === row.key}
                onPress={() => {
                  setPair(row);
                  setPage(0);
                }}
              />
            </View>
          ))}
          <Text className="text-base font-t3-medium text-foreground">Saved races</Text>
          {visible.map((record) => (
            <RaceRecord
              key={record.raceId}
              record={record}
              availableThreads={availableThreads}
              openThread={openThread}
              canShare={canExport}
              onShare={() => {
                void exportFile("md", [record]);
              }}
              expanded={expanded === record.raceId}
              onPress={() => setExpanded(expanded === record.raceId ? null : record.raceId)}
            />
          ))}
          {filtered.length === 0 ? (
            <Text className="py-6 text-sm text-foreground-muted">
              {records.length
                ? "No races match these filters."
                : "No saved races yet. Keep a winner or decide No winner on your computer to start recording history."}
            </Text>
          ) : null}
          {filtered.length > PAGE_SIZE ? (
            <View className="flex-row items-center justify-between gap-2">
              <Chip
                label="Previous"
                disabled={currentPage === 0}
                onPress={() => setPage(currentPage - 1)}
              />
              <Text className="text-xs text-foreground-muted">
                {currentPage * PAGE_SIZE + 1}–
                {Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} / {filtered.length}
              </Text>
              <Chip
                label="Next"
                disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length}
                onPress={() => setPage(currentPage + 1)}
              />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function RaceRecord({
  record,
  availableThreads,
  openThread,
  canShare,
  onShare,
  expanded,
  onPress,
}: {
  readonly record: RaceHistoryRecord;
  readonly availableThreads: ReadonlySet<ThreadId>;
  readonly openThread: (threadId: ThreadId) => void;
  readonly canShare: boolean;
  readonly onShare: () => void;
  readonly expanded: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const winner = record.entrants.find((entrant) => entrant.slot === record.keptSlot);
  return (
    <View className="border-b border-border py-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${record.titleSeed || record.raceId}, ${record.outcome}, ${expanded ? "collapse" : "inspect evidence"}`}
        onPress={onPress}
        className="gap-1 py-2 active:opacity-60"
      >
        <Text className="text-sm font-t3-medium text-foreground">
          {record.titleSeed || record.raceId}
        </Text>
        <Text className="text-xs text-foreground-muted">
          {record.projectTitle || record.projectId} · {new Date(record.startedAt).toLocaleString()}
        </Text>
        <Text className="text-xs text-foreground-muted">
          {record.outcome === "kept"
            ? `Kept ${winner?.label ?? `entrant ${record.keptSlot}`}`
            : record.outcome === "none"
              ? "No winner"
              : "Undecided"}{" "}
          · {RACE_TASK_KIND_LABELS[record.taskKind]} {expanded ? "▴" : "▾"}
        </Text>
      </Pressable>
      {expanded ? (
        <View className="gap-3 py-3">
          <Chip label="Share this race evidence" disabled={!canShare} onPress={onShare} />
          <Text selectable className="text-sm leading-normal text-foreground">
            {record.prompt}
          </Text>
          {record.entrants.map((entrant) => (
            <View key={entrant.slot} className="gap-1">
              <Text className="text-sm text-foreground">
                #{entrant.slot} {entrant.label} · {entrant.phase}
              </Text>
              <Text className="text-xs text-foreground-muted">
                {entrant.files} files · +{entrant.additions} / −{entrant.deletions} ·{" "}
                {elapsed(entrant.elapsedMs)} · {cost(entrant.costUsd)}
              </Text>
              {entrant.threadId && availableThreads.has(entrant.threadId) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open entrant ${entrant.slot} conversation`}
                  className="min-h-11 justify-center active:opacity-60"
                  onPress={() => entrant.threadId && openThread(entrant.threadId)}
                >
                  <Text className="text-sm text-primary">Open conversation ›</Text>
                </Pressable>
              ) : (
                <Text className="text-xs text-foreground-muted">
                  {entrant.threadId
                    ? "Conversation no longer available on this computer"
                    : "Conversation link was not recorded"}
                </Text>
              )}
              {entrant.failure ? (
                <Text selectable className="text-xs text-danger">
                  {entrant.failure}
                </Text>
              ) : null}
            </View>
          ))}
          {record.judge ? (
            <Text className="text-xs text-foreground-muted">
              Judge {record.judge.label}:{" "}
              {record.judge.pickSlot === null ? "no winner" : `entrant #${record.judge.pickSlot}`}
            </Text>
          ) : null}
          {record.judge?.threadId && availableThreads.has(record.judge.threadId) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open judge conversation"
              className="min-h-11 justify-center active:opacity-60"
              onPress={() => record.judge?.threadId && openThread(record.judge.threadId)}
            >
              <Text className="text-sm text-primary">Open judge conversation ›</Text>
            </Pressable>
          ) : null}
          <Text className="text-xs text-foreground-muted">
            Captured record {new Date(record.recordedAt).toLocaleString()}. Original prompt may be
            capped at 2,000 characters by the host.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
