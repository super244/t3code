/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=15m; seat=codex; date=2026-10-10 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=29m; seat=codex; date=2026-10-09 */
import { useRef, useState } from "react";
import { Alert, Pressable, Share, View } from "react-native";
import type { RoutineDefinition, ThreadId } from "@t3tools/contracts";
import {
  makeRoutineHistoryReport,
  ROUTINE_HISTORY_LABELS,
  ROUTINE_OUTCOME_LABELS,
  ROUTINE_SKIP_LABELS,
  routineOutcomeLabel,
  selectRoutineRuns,
  type RoutineHistoryFilter,
  type RoutineOutcomeFilter,
} from "@t3tools/client-runtime/routines";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";

function time(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function RoutineRunHistory({
  routine,
  routineId,
  environmentId,
  onOpenThread,
}: {
  readonly routine: RoutineDefinition;
  readonly routineId: string;
  readonly environmentId: string;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const [filter, setFilter] = useState<RoutineHistoryFilter>("all");
  const [outcome, setOutcome] = useState<RoutineOutcomeFilter>("all");
  const [sharing, setSharing] = useState(false);
  const shareInFlight = useRef(false);
  const total = routine.runHistory?.length ?? 0;
  const receipts = selectRoutineRuns(routine, filter, outcome);
  async function shareHistory() {
    if (shareInFlight.current) return;
    const report = makeRoutineHistoryReport({
      routine,
      routineId,
      environmentId,
      exportedAt: new Date().toISOString(),
    });
    shareInFlight.current = true;
    setSharing(true);
    try {
      await Share.share({
        title: `${routine.name} execution history`,
        message: JSON.stringify(report, null, 2),
      });
    } catch {
      Alert.alert("History could not be shared", "The recorded history is unchanged. Try again.");
    } finally {
      shareInFlight.current = false;
      setSharing(false);
    }
  }
  return (
    <View
      accessibilityLabel="Routine execution history"
      className="gap-2 border-t border-border pt-3"
    >
      <Text accessibilityRole="header" className="text-sm font-t3-medium">
        Execution history
      </Text>
      <Text className="text-xs text-foreground-muted">
        {total} retained occurrences · latest 50
      </Text>
      <Text className="text-xs leading-normal text-foreground-muted">
        Launch and first-turn outcome are recorded separately. A completed turn does not verify the
        task’s correctness. Open the thread to review the work.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {(
          [["all", "All"], ...Object.entries(ROUTINE_HISTORY_LABELS)] as [
            RoutineHistoryFilter,
            string,
          ][]
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === value }}
            accessibilityLabel={`History: ${label}`}
            className={cn(
              "min-h-11 justify-center border-b border-border px-2",
              filter === value && "border-primary",
            )}
            onPress={() => setFilter(value)}
          >
            <Text
              className={cn("text-xs text-foreground-muted", filter === value && "text-foreground")}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text className="text-xs text-foreground-muted">Turn outcome</Text>
      <View className="flex-row flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["unrecorded", "Unrecorded"],
            ...Object.entries(ROUTINE_OUTCOME_LABELS),
          ] as [RoutineOutcomeFilter, string][]
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: outcome === value }}
            accessibilityLabel={`Outcome: ${label}`}
            className={cn(
              "min-h-11 justify-center border-b border-border px-2",
              outcome === value && "border-primary",
            )}
            onPress={() => setOutcome(value)}
          >
            <Text
              className={cn(
                "text-xs text-foreground-muted",
                outcome === value && "text-foreground",
              )}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: total === 0 || sharing }}
        disabled={total === 0 || sharing}
        className={cn(
          "min-h-11 justify-center border-b border-border",
          (total === 0 || sharing) && "opacity-50",
        )}
        onPress={() => void shareHistory()}
      >
        <Text className="text-sm">{sharing ? "Sharing…" : "Share history JSON"}</Text>
      </Pressable>
      {receipts.map((receipt) => (
        <View key={receipt.id} className="gap-1 border-b border-border py-3">
          <Text
            className={cn("text-sm font-t3-medium", receipt.status === "failed" && "text-danger")}
          >
            {ROUTINE_HISTORY_LABELS[receipt.status]}
          </Text>
          {receipt.status === "launched" ? (
            <Text
              className={cn(
                "text-xs text-foreground-muted",
                receipt.outcome?.status === "failed" && "text-danger",
              )}
            >
              {routineOutcomeLabel(receipt)}
              {receipt.outcome ? ` · ${time(receipt.outcome.recordedAt)}` : ""}
            </Text>
          ) : null}
          <Text className="text-xs">Scheduled {time(receipt.scheduledAt)}</Text>
          <Text className="text-xs text-foreground-muted">
            {receipt.startedAt
              ? `Started ${time(receipt.startedAt)}`
              : `Skipped ${time(receipt.updatedAt)}`}
          </Text>
          <Text selectable className="text-xs text-foreground-muted">
            {receipt.modelSelection.model} · {receipt.modelSelection.instanceId}
          </Text>
          <Text selectable className="text-xs text-foreground-muted">
            Project: {receipt.projectId} · {receipt.runtimeMode} · {receipt.interactionMode}
          </Text>
          <Text selectable className="text-xs text-foreground-muted">
            Occurrence: {receipt.id}
          </Text>
          {receipt.outcome ? (
            <Text selectable className="text-xs text-foreground-muted">
              Outcome event: {receipt.outcome.eventSequence} · First turn:{" "}
              {receipt.outcome.turnId ?? "Not recorded"}
            </Text>
          ) : null}
          {receipt.outcome?.reason ? (
            <Text selectable className="text-xs text-foreground-muted">
              {receipt.outcome.reason}
            </Text>
          ) : null}
          {receipt.error ? (
            <Text selectable className="text-xs text-danger">
              {receipt.error}
            </Text>
          ) : null}
          {receipt.skipReason ? (
            <Text className="text-xs text-foreground-muted">
              {ROUTINE_SKIP_LABELS[receipt.skipReason]}
            </Text>
          ) : null}
          {receipt.dailyLaunchBudget ? (
            <Text className="text-xs text-foreground-muted">
              {" "}
              Recorded {receipt.dailyLaunchBudget.attempts}
              {receipt.dailyLaunchBudget.limit === null
                ? " attempts"
                : ` / ${receipt.dailyLaunchBudget.limit} attempts`}
              {" · "}
              {receipt.dailyLaunchBudget.day}
              {" · "}
              {receipt.dailyLaunchBudget.timeZone}{" "}
            </Text>
          ) : null}
          {receipt.blockingThreadId ? (
            <Pressable
              accessibilityRole="button"
              className="min-h-11 justify-center"
              onPress={() => onOpenThread(receipt.blockingThreadId!)}
            >
              <Text className="text-sm text-primary">Open active task</Text>
            </Pressable>
          ) : null}
          {receipt.threadId ? (
            <Pressable
              accessibilityRole="button"
              className="min-h-11 justify-center"
              onPress={() => onOpenThread(receipt.threadId!)}
            >
              <Text className="text-sm text-primary">Open task</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {receipts.length === 0 ? (
        <Text className="py-3 text-xs text-foreground-muted">
          {total
            ? "No occurrences match these filters."
            : "No occurrence receipts recorded yet. Existing tasks remain in project history."}
        </Text>
      ) : null}
    </View>
  );
}
