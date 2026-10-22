/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=1m; seat=codex; date=2026-10-18 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=15m; seat=codex; date=2026-10-10 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=29m; seat=codex; date=2026-10-09 */
import { useState } from "react";
import { ArrowUpRightIcon, DownloadIcon } from "lucide-react";
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
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { formatRoutineTime } from "./routinePresentation";

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
  const [query, setQuery] = useState("");
  const receipts = selectRoutineRuns(routine, filter, outcome, query);
  const total = routine.runHistory?.length ?? 0;
  function exportHistory() {
    const report = makeRoutineHistoryReport({
      routine,
      routineId,
      environmentId,
      exportedAt: new Date().toISOString(),
      filter,
      outcome,
      query,
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `t3-routine-history-${report.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section
      aria-label="Routine execution history"
      className="mt-6 min-w-0 border-t border-border pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Execution history</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {receipts.length} shown · {total} retained occurrences · latest 50
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={receipts.length === 0}
          onClick={exportHistory}
        >
          <DownloadIcon /> Export shown
        </Button>
      </div>
      <p className="my-3 text-xs text-muted-foreground">
        Launch and first-turn outcome are recorded separately. A completed turn does not verify the
        task’s correctness. Open the thread to review the work.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          Search retained receipts
          <input
            type="search"
            value={query}
            maxLength={160}
            className="h-8 max-w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
            placeholder="Error, model, date, task…"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Launch
          <select
            aria-label="Execution history status"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value as RoutineHistoryFilter)}
          >
            <option value="all">All occurrences</option>
            {Object.entries(ROUTINE_HISTORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Outcome
          <select
            aria-label="Execution history outcome"
            className="h-8 max-w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
            value={outcome}
            onChange={(event) => setOutcome(event.currentTarget.value as RoutineOutcomeFilter)}
          >
            <option value="all">All outcomes</option>
            <option value="unrecorded">No recorded outcome</option>
            {Object.entries(ROUTINE_OUTCOME_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3">
        {receipts.map((receipt) => (
          <div key={receipt.id} className="border-b border-border py-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    receipt.status === "failed"
                      ? "error"
                      : receipt.status === "running"
                        ? "info"
                        : "secondary"
                  }
                >
                  {ROUTINE_HISTORY_LABELS[receipt.status]}
                </Badge>
                <span>Scheduled {formatRoutineTime(receipt.scheduledAt)}</span>
              </div>
              {receipt.threadId ? (
                <Button variant="ghost" size="sm" onClick={() => onOpenThread(receipt.threadId!)}>
                  <ArrowUpRightIcon /> Open task
                </Button>
              ) : null}
            </div>
            {receipt.status === "launched" ? (
              <p
                className={`mt-2 ${receipt.outcome?.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {routineOutcomeLabel(receipt)}
                {receipt.outcome ? ` · ${formatRoutineTime(receipt.outcome.recordedAt)}` : ""}
              </p>
            ) : null}
            {receipt.skipReason ? (
              <p className="mt-2 text-muted-foreground">
                {ROUTINE_SKIP_LABELS[receipt.skipReason]}
              </p>
            ) : null}
            {receipt.dailyLaunchBudget ? (
              <p className="mt-1 text-muted-foreground">
                {" "}
                Recorded {receipt.dailyLaunchBudget.attempts}
                {receipt.dailyLaunchBudget.limit === null
                  ? " attempts"
                  : ` / ${receipt.dailyLaunchBudget.limit} attempts`}
                {" · "}
                {receipt.dailyLaunchBudget.day}
                {" · "}
                {receipt.dailyLaunchBudget.timeZone}{" "}
              </p>
            ) : null}
            {receipt.blockingThreadId ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() => onOpenThread(receipt.blockingThreadId!)}
              >
                <ArrowUpRightIcon /> Open active task
              </Button>
            ) : null}
            <p className="mt-1 break-words text-muted-foreground">
              {receipt.startedAt
                ? `Started ${formatRoutineTime(receipt.startedAt)}`
                : `Skipped ${formatRoutineTime(receipt.updatedAt)}`}{" "}
              · {receipt.modelSelection.model} · {receipt.modelSelection.instanceId}
            </p>
            <details className="mt-2 text-muted-foreground">
              <summary className="cursor-pointer">Receipt details</summary>
              <div className="mt-2 grid gap-1 break-all">
                <div>Occurrence: {receipt.id}</div>
                <div>Project: {receipt.projectId}</div>
                <div>
                  Permission mode: {receipt.runtimeMode} · {receipt.interactionMode}
                </div>
                <div>Last recorded: {formatRoutineTime(receipt.updatedAt)}</div>
                {receipt.launchSequence !== undefined ? (
                  <div>Launch event: {receipt.launchSequence}</div>
                ) : null}
                {receipt.turnId ? <div>First turn: {receipt.turnId}</div> : null}
                {receipt.outcome ? <div>Outcome event: {receipt.outcome.eventSequence}</div> : null}
              </div>
            </details>
            {receipt.outcome?.reason ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                {receipt.outcome.reason}
              </p>
            ) : null}
            {receipt.error ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-destructive">
                {receipt.error}
              </p>
            ) : null}
          </div>
        ))}
        {receipts.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">
            {total
              ? "No occurrences match these filters."
              : "No occurrence receipts recorded yet. Existing tasks remain in project history."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
