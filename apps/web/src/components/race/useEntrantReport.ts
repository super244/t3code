/* agent-watermark: model=opus-5.5; effort=high; duration=12m; seat=claude-code; date=2026-10-19 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useThread } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { reviewEnvironment } from "../../state/review";
import {
  combineEntrantChanges,
  reportedSessionCostUsd,
  type RaceEntrantChanges,
} from "./raceArena.logic";
import { raceEntrantPhase } from "./race.logic";

/** What each entrant view learns about its entrant and hands up to the race. */
export interface EntrantReport {
  readonly changes: RaceEntrantChanges | null;
  readonly diffText: string;
  readonly diffError: string | null;
  readonly finalMessage: string | null;
  /** The shared race prompt as this entrant received it. */
  readonly prompt: string | null;
  /** Session cost the provider reported; null when it reported none. */
  readonly costUsd: number | null;
  readonly failure: string | null;
}

const DIFF_REFRESH_WHILE_WORKING_MS = 4_000;

function sameEntrantReport(left: EntrantReport | undefined, right: EntrantReport): boolean {
  return (
    left !== undefined &&
    left.diffText === right.diffText &&
    left.finalMessage === right.finalMessage &&
    left.diffError === right.diffError &&
    left.prompt === right.prompt &&
    left.costUsd === right.costUsd &&
    left.failure === right.failure &&
    (left.changes === null) === (right.changes === null)
  );
}

/**
 * An entrant's work as the race compares it: the worktree's committed,
 * uncommitted and untracked changes (re-read while it works and once when it
 * stops) plus what its thread says. The board and the arena both read entrants
 * through this, so their numbers always agree.
 */
export function useEntrantReport(
  shell: EnvironmentThreadShell,
  /** The race's base commit: diffs read against it stay whole after Keep moves the base branch. */
  baseRef: string | null = null,
) {
  const thread = useThread(scopeThreadRef(shell.environmentId, shell.id));
  const phase = raceEntrantPhase(shell);
  const working = phase === "working" || phase === "preparing";

  const diff = useEnvironmentQuery(
    shell.worktreePath
      ? reviewEnvironment.diffPreview({
          environmentId: shell.environmentId,
          input: { cwd: shell.worktreePath, ...(baseRef ? { baseRef } : {}) },
        })
      : null,
  );
  const refreshDiff = diff.refresh;
  useEffect(() => {
    if (!working || !shell.worktreePath) return;
    const handle = window.setInterval(refreshDiff, DIFF_REFRESH_WHILE_WORKING_MS);
    return () => window.clearInterval(handle);
  }, [working, refreshDiff, shell.worktreePath]);
  // One more read when the entrant stops, so the final state is what's compared.
  const completedAt = shell.latestTurn?.completedAt ?? null;
  useEffect(() => {
    if (completedAt) refreshDiff();
  }, [completedAt, refreshDiff]);

  const sources = diff.data?.sources ?? null;
  const committed = sources?.find((source) => source.kind === "branch-range") ?? null;
  const uncommitted = sources?.find((source) => source.kind === "working-tree") ?? null;
  const changes = useMemo(
    () =>
      sources
        ? combineEntrantChanges({
            committed: committed?.diff,
            uncommitted: uncommitted?.diff,
            truncated: (committed?.truncated ?? false) || (uncommitted?.truncated ?? false),
          })
        : null,
    [sources, committed, uncommitted],
  );
  const diffText = [committed?.diff ?? "", uncommitted?.diff ?? ""]
    .filter((text) => text.trim().length > 0)
    .join("\n");

  const messages = thread?.messages;
  const activities = thread?.activities;
  const lastError = thread?.session?.lastError ?? null;
  const report = useMemo<EntrantReport>(() => {
    const list = messages ?? [];
    return {
      changes,
      diffText,
      diffError: diff.error,
      finalMessage:
        list.toReversed().find((message) => message.role === "assistant" && !message.streaming)
          ?.text ?? null,
      prompt: list.find((message) => message.role === "user")?.text ?? null,
      costUsd: reportedSessionCostUsd(activities ?? []),
      failure: lastError,
    };
  }, [changes, diffText, diff.error, messages, activities, lastError]);

  return { thread, report, phase, working };
}

/** Collects the reports entrant views hand up, keyed by thread id. */
export function useEntrantReports() {
  const [reports, setReports] = useState<ReadonlyMap<string, EntrantReport>>(() => new Map());
  const report = useCallback((threadId: string, next: EntrantReport) => {
    setReports((current) => {
      if (sameEntrantReport(current.get(threadId), next)) return current;
      const copy = new Map(current);
      copy.set(threadId, next);
      return copy;
    });
  }, []);
  return [reports, report] as const;
}
