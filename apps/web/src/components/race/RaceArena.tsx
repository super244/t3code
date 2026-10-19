/* agent-watermark: model=opus-5.5; effort=high; duration=40m; seat=claude-code; date=2026-10-19 */
/* agent-watermark: model=opus-5.5; effort=high; duration=95m; seat=claude-code; date=2026-10-18 */
import { FileDiff } from "@pierre/diffs/react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  type OrchestrationMessage,
  type RaceHistoryJudge,
  type RaceHistoryRecord,
  type RaceTaskKind,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  guessRaceTaskKind,
  RACE_TASK_KIND_LABELS,
  type RaceHeatView,
} from "@t3tools/shared/raceHistory";
import {
  buildRaceJudgeBrief,
  buildRaceJudgeTitle,
  parseRaceJudgeHeat,
  parseRaceJudgeMarker,
  parseRaceJudgeVerdict,
  RACE_MAX_SLOTS,
  type RaceJudgeVerdict,
} from "@t3tools/shared/race";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleSlashIcon,
  CrownIcon,
  FileDiffIcon,
  FlagIcon,
  GavelIcon,
  Trash2Icon,
  TriangleAlertIcon,
  SwordsIcon,
  TrophyIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isElectron } from "../../env";
import { useTheme } from "../../hooks/useTheme";
import { resolveDiffThemeName, getRenderablePatch } from "../../lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "../../lib/syntaxHighlighting";
import { cn, newMessageId, newThreadId } from "../../lib/utils";
import { deriveWorkLogEntries } from "../../session-logic";
import { useThread, useThreadShells, waitForThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useUiStateStore } from "../../uiStateStore";
import ChatMarkdown from "../ChatMarkdown";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { PHASE_PRESENTATION } from "./RaceBoard";
import { RaceSelect } from "./RaceComposer";
import { formatRaceAgentLabel, raceModelLabel, raceProviderLabel } from "./raceLabels";
import { useEntrantReport, useEntrantReports, type EntrantReport } from "./useEntrantReport";
import { useRaceRecorder } from "./useRaceRecorder";
import { useRaceBase } from "./useRaceBase";
import { useRaceHistoryRecord } from "./useRaceHistoryRecord";
import { openRematchDialog } from "../../raceDialog";
import {
  buildRaceEntrantFeed,
  buildRaceFileMatrix,
  formatRaceDuration,
  raceEntrantElapsedMs,
  raceJudgePhase,
  type RaceEntrantChanges,
  type RaceJudgePhase,
  type RaceFeedItem,
} from "./raceArena.logic";
import {
  canKeepRaceEntrant,
  raceEntrantPhase,
  raceProviders,
  type RaceEntrant,
  type RaceEntrantPhase,
  type RaceGroup,
} from "./race.logic";
import {
  raceEntrantLabel,
  raceEntrantProvider,
  useRaceEntrantActions,
  type RaceBoardContext,
} from "./useRaceEntrantActions";

type Race = RaceGroup<EnvironmentThreadShell>;
type Entrant = RaceEntrant<EnvironmentThreadShell>;
type EntrantFile = RaceEntrantChanges["files"][number];

const EMPTY_MESSAGES: ReadonlyArray<OrchestrationMessage> = [];

// Each lane is a column on wide screens; literal classes so Tailwind sees them.
const LANE_COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-2 2xl:grid-cols-4",
};

// Lane accents keep an entrant recognisable between its lane and its matrix column.
const LANE_ACCENTS = [
  "bg-sky-500 dark:bg-sky-400",
  "bg-violet-500 dark:bg-violet-400",
  "bg-amber-500 dark:bg-amber-400",
  "bg-emerald-500 dark:bg-emerald-400",
] as const;

function laneAccent(slot: number): string {
  return LANE_ACCENTS[(slot - 1) % LANE_ACCENTS.length]!;
}

function useNow(active: boolean, intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const handle = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(handle);
  }, [active, intervalMs]);
  return now;
}

export function RaceArena({
  race,
  raceId,
  loading = false,
  context,
}: {
  race: Race | null;
  raceId: string;
  /** Threads are still arriving, so a missing race may simply not be here yet. */
  loading?: boolean;
  context: RaceBoardContext;
}) {
  const navigate = useNavigate();
  const backToBoard = useCallback(() => void navigate({ to: "/race", search: {} }), [navigate]);

  return (
    <SidebarInset className="isolate h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Race arena breadcrumb" className="min-w-0 flex-1">
            <WorkspaceBreadcrumbItem>
              <button
                type="button"
                onClick={backToBoard}
                className="inline-flex items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <FlagIcon className="size-3.5" />
                Race
              </button>
            </WorkspaceBreadcrumbItem>
            <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" />
            <WorkspaceBreadcrumbItem current className="min-w-0">
              <h1 className="truncate">{race?.titleSeed ?? "Race"}</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <Button
            size="sm"
            variant="ghost"
            onClick={backToBoard}
            className="shrink-0"
            aria-label="All races"
          >
            <ArrowLeftIcon /> <span className="hidden sm:inline">All races</span>
          </Button>
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          {race ? (
            <RaceArenaBody race={race} context={context} />
          ) : loading ? (
            <p className="px-6 py-24 text-center text-sm text-muted-foreground">
              Loading the race…
            </p>
          ) : (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
              <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <FlagIcon className="size-5" />
              </span>
              <h2 className="text-sm font-medium">This race is no longer here</h2>
              <p className="text-xs text-muted-foreground">
                Race <span className="font-mono">{raceId}</span> has no entrants left on any
                connected computer. Keeping a winner or discarding every entrant ends a race, and a
                computer that is offline hides its races until it reconnects.
              </p>
              <Button size="sm" variant="outline" onClick={backToBoard}>
                <ArrowLeftIcon /> All races
              </Button>
            </div>
          )}
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function RaceArenaBody({ race, context }: { race: Race; context: RaceBoardContext }) {
  const actions = useRaceEntrantActions(race, context);
  const [reports, report] = useEntrantReports();
  const base = useRaceBase(race);
  const { history, historyLoaded, recorded, currentHeat, currentHeatView } =
    useRaceHistoryRecord(race);
  const recordResult = useRaceRecorder(race, context, reports, {
    heat: currentHeat,
    baseCommit: base.commit,
  });
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [kept, setKept] = useState<{ readonly slot: number; readonly label: string } | null>(null);
  const judgeForKeep = useRef<RaceHistoryJudge | null>(null);
  const keepEntrant = useCallback(
    async (entrant: Entrant) => {
      const label = raceEntrantLabel(race, entrant, context);
      // Snapshot before Keep discards the losers, so their lines are recorded too.
      const entrants = race.entrants;
      if (await actions.keep(entrant)) {
        setKept({ slot: entrant.slot, label });
        await recordResult(
          { outcome: "kept", keptSlot: entrant.slot, judge: judgeForKeep.current },
          entrants,
        );
      }
    },
    [actions, context, race, recordResult],
  );

  const phases = race.entrants.map((entrant) => raceEntrantPhase(entrant.thread));
  const anyWorking = phases.some((phase) => phase === "working" || phase === "preparing");
  const finishedCount = phases.filter((phase) => phase === "finished").length;
  const now = useNow(anyWorking);
  const environmentLabel =
    context.environmentLabels.size > 1 ? context.environmentLabels.get(race.environmentId) : null;

  const matrix = useMemo(
    () =>
      buildRaceFileMatrix<EntrantFile>(
        race.entrants.map((entrant) => reports.get(entrant.thread.id)?.changes?.files ?? null),
      ),
    [race.entrants, reports],
  );

  const judge = useRaceJudge(race, currentHeat);
  const judgeOfRecord = judge.report?.judge ?? null;
  useEffect(() => {
    judgeForKeep.current = judgeOfRecord;
  }, [judgeOfRecord]);
  const entrantSlots = useMemo(() => race.entrants.map((entrant) => entrant.slot), [race.entrants]);

  // A judge's finished verdict goes into the history as soon as it is in.
  const recordedJudge = useRef<string | null>(null);
  const judgeReport = judge.report;
  const allLoaded = race.entrants.every((entrant) => reports.get(entrant.thread.id)?.changes);
  const recordedJudgeKey = currentHeatView?.judge
    ? `${currentHeatView.judge.label}:${currentHeatView.judge.pickSlot ?? "none"}`
    : null;
  useEffect(() => {
    if (!judgeReport?.done || judgeReport.verdict === null || !allLoaded || !historyLoaded) return;
    const key = `${judgeReport.judge.label}:${judgeReport.judge.pickSlot ?? "none"}`;
    // Already in the history (this visit or an earlier one): nothing to send.
    if (recordedJudge.current === key || recordedJudgeKey === key) return;
    recordedJudge.current = key;
    void recordResult({ outcome: "open", judge: judgeReport.judge });
  }, [judgeReport, allLoaded, historyLoaded, recordedJudgeKey, recordResult]);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pt-5 pb-14 sm:px-6">
      <section aria-label="Race summary" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Arena · {actions.project?.title ?? "Unknown project"}
              {environmentLabel ? ` · ${environmentLabel}` : ""}
            </p>
            <h2 className="mt-1 text-lg leading-snug font-semibold text-balance">
              {race.titleSeed}
            </h2>
          </div>
          <dl className="flex shrink-0 items-stretch divide-x divide-border overflow-hidden rounded-xl border border-border/70 bg-card/60 text-xs">
            <SummaryStat label="Entrants" value={String(race.entrants.length)} />
            <SummaryStat label="Finished" value={`${finishedCount}/${race.entrants.length}`} />
            <SummaryStat
              label="Shared files"
              value={matrix.rows.length === 0 ? "—" : String(matrix.sharedCount)}
            />
            <SummaryStat label="Started" value={formatRelativeTimeLabel(race.startedAt)} />
          </dl>
        </div>
        <RacePrompt race={race} />
        <RaceRecordBar
          record={recorded}
          heat={currentHeatView}
          heatNumber={currentHeat}
          historyError={history.error}
          guessedKind={guessRaceTaskKind(
            reports.get(race.entrants[0]?.thread.id ?? "")?.prompt ?? race.titleSeed,
          )}
          canClose={
            phases.every((phase) => phase === "finished" || phase === "failed") && allLoaded
          }
          // "open" never undoes a decision, so a kind change can't reopen a heat.
          onKindChange={(taskKind) => void recordResult({ outcome: "open", taskKind })}
          onCloseWithoutWinner={() =>
            void recordResult({ outcome: "none", judge: judge.report?.judge ?? null })
          }
          rematch={{
            available:
              base.commit !== null &&
              race.entrants.length > 0 &&
              Math.max(race.count, ...race.entrants.map((entrant) => entrant.slot)) <
                RACE_MAX_SLOTS,
            reason:
              base.commit === null
                ? base.loading
                  ? "Finding the commit this race started from…"
                  : "The commit this race started from is no longer known, so a fair rematch can't start."
                : `This race has used all ${RACE_MAX_SLOTS} entrant slots.`,
            onStart: () => {
              const project = actions.project;
              if (!project || !base.commit) return;
              const firstShell = race.entrants[0]!.thread;
              openRematchDialog({
                environmentId: race.environmentId,
                projectId: race.projectId,
                baseBranch: base.commit,
                checkoutCwd: null,
                sourceThreadId: firstShell.id,
                sourceModel: null,
                prompt: reports.get(firstShell.id)?.prompt ?? race.titleSeed,
                rematch: {
                  raceId: race.raceId,
                  titleSeed: race.titleSeed,
                  startedAt: race.startedAt,
                  existingCount: Math.max(
                    race.count,
                    ...race.entrants.map((entrant) => entrant.slot),
                    ...(recorded?.entrants.map((entrant) => entrant.slot) ?? []),
                  ),
                  liveSlots: race.entrants.map((entrant) => entrant.slot),
                  baseCommit: base.commit,
                  heat: currentHeat + 1,
                  projectTitle: project.title,
                },
              });
            },
          }}
        />
        {kept ? (
          <div
            role="status"
            className="flex min-w-0 items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3.5 py-2.5 text-sm"
          >
            <CheckIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
            <p className="min-w-0">
              <span className="font-medium">Entrant {kept.slot}</span> ({kept.label}) was
              squash-merged into {actions.checkoutBranch ?? "the project checkout"}. Its thread and
              worktree stay until you discard them.
            </p>
          </div>
        ) : null}
      </section>

      <section
        aria-label="Entrants"
        className={cn(
          "grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2",
          LANE_COLUMNS[race.entrants.length] ?? "lg:grid-cols-2",
        )}
      >
        {race.entrants.map((entrant) => (
          <EntrantLane
            key={entrant.thread.id}
            race={race}
            entrant={entrant}
            context={context}
            now={now}
            busy={actions.pendingThreadId !== null}
            pending={actions.pendingThreadId === entrant.thread.id}
            keepTarget={actions.checkoutBranch}
            judgePick={judge.verdict?.kind === "winner" && judge.verdict.slot === entrant.slot}
            baseRef={base.commit}
            onReport={report}
            onKeep={() => void keepEntrant(entrant)}
            onDiscard={() => void actions.discard(entrant)}
          />
        ))}
      </section>

      <RaceJudgePanel
        race={race}
        context={context}
        judge={judge}
        reports={reports}
        entrantSlots={entrantSlots}
        checkoutBranch={actions.checkoutBranch}
        projectWorkspaceRoot={actions.project?.workspaceRoot ?? null}
        busy={actions.pendingThreadId !== null}
        onKeep={(slot) => {
          const entrant = race.entrants.find((item) => item.slot === slot);
          if (entrant) void keepEntrant(entrant);
        }}
      />

      <RaceChangesMatrix
        race={race}
        context={context}
        matrix={matrix}
        reports={reports}
        expandedPath={expandedPath}
        onToggle={(path) => setExpandedPath((current) => (current === path ? null : path))}
      />
    </div>
  );
}

const TASK_KIND_OPTIONS = (Object.keys(RACE_TASK_KIND_LABELS) as RaceTaskKind[]).map((kind) => ({
  value: kind,
  label: RACE_TASK_KIND_LABELS[kind],
}));

/**
 * Where this race stands in the history: its kind of task (a guess until the
 * user picks one), whether a result is recorded, and a way to close it without
 * a winner so a race nobody keeps still counts on the scoreboard.
 */
function RaceRecordBar({
  record,
  heat,
  heatNumber,
  historyError,
  guessedKind,
  canClose,
  onKindChange,
  onCloseWithoutWinner,
  rematch,
}: {
  record: RaceHistoryRecord | null;
  heat: RaceHeatView | null;
  heatNumber: number;
  historyError: string | null;
  guessedKind: RaceTaskKind;
  canClose: boolean;
  onKindChange: (kind: RaceTaskKind) => void;
  onCloseWithoutWinner: () => void;
  rematch: { available: boolean; reason: string; onStart: () => void };
}) {
  const kind = record?.taskKind ?? guessedKind;
  const guessed = !record || record.taskKindSource === "guessed";
  const keptEntrant =
    heat?.outcome === "kept"
      ? (record?.entrants.find((entrant) => entrant.slot === heat.keptSlot) ?? null)
      : null;
  const decided = heat?.outcome === "kept" || heat?.outcome === "none";
  const heatLabel = heatNumber > 1 ? `Rematch ${heatNumber - 1} · ` : "";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Kind of task</span>
        <div className="w-32">
          <RaceSelect
            ariaLabel="Kind of task"
            value={kind}
            options={TASK_KIND_OPTIONS}
            onChange={(value) => onKindChange(value as RaceTaskKind)}
          />
        </div>
        {guessed ? (
          <span className="text-[11px] text-muted-foreground/80">guessed from the prompt</span>
        ) : null}
      </div>
      <span aria-hidden className="hidden h-4 w-px bg-border sm:block" />
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <TrophyIcon className="size-3.5 shrink-0 text-muted-foreground" />
        {historyError ? (
          <span className="truncate text-destructive">History unavailable: {historyError}</span>
        ) : heat?.outcome === "kept" ? (
          <span className="truncate">
            {heatLabel}On the scoreboard · kept{" "}
            <span className="font-medium">#{heat.keptSlot}</span>
            {keptEntrant ? ` ${keptEntrant.label}` : ""}
          </span>
        ) : heat?.outcome === "none" ? (
          <span>{heatLabel}On the scoreboard · no winner</span>
        ) : heat?.judge ? (
          <span>{heatLabel}Judged · not decided yet</span>
        ) : heatNumber > 1 ? (
          <span>{heatLabel}racing — keep a winner or close it without one</span>
        ) : (
          <span className="text-muted-foreground">
            Not on the scoreboard yet — keep a winner or close it without one
          </span>
        )}
      </span>
      {decided ? (
        <Tooltip>
          <TooltipTrigger render={<span className="sm:ml-auto" />}>
            <Button
              size="sm"
              variant="outline"
              disabled={!rematch.available}
              onClick={rematch.onStart}
            >
              <SwordsIcon /> Rematch
            </Button>
          </TooltipTrigger>
          <TooltipPopup side="top">
            {rematch.available
              ? "New entrants race on the same prompt from the same commit; whoever is still here defends"
              : rematch.reason}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {!decided ? (
        <Tooltip>
          <TooltipTrigger render={<span className="sm:ml-auto" />}>
            <Button size="sm" variant="ghost" disabled={!canClose} onClick={onCloseWithoutWinner}>
              <CircleSlashIcon /> No winner
            </Button>
          </TooltipTrigger>
          <TooltipPopup side="top">
            {canClose
              ? "Record this race as having no winner; its entrants stay until you discard them"
              : "Available when every entrant has stopped"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3.5 py-2">
      <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="truncate text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** The full shared prompt, read from the first entrant that has loaded. */
function RacePrompt({ race }: { race: Race }) {
  const first = race.entrants[0]!;
  const thread = useThread(scopeThreadRef(first.thread.environmentId, first.thread.id));
  const prompt = thread?.messages.find((message) => message.role === "user")?.text ?? null;
  const [open, setOpen] = useState(false);
  if (!prompt || prompt.trim() === race.titleSeed.trim()) return null;
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3.5 py-2.5">
      <p
        className={cn(
          "text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground",
          !open && "line-clamp-2",
        )}
      >
        {prompt}
      </p>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-1 text-[11px] font-medium text-foreground/80 hover:text-foreground"
      >
        {open ? "Show less" : "Show the whole prompt"}
      </button>
    </div>
  );
}

function EntrantLane({
  race,
  entrant,
  context,
  now,
  busy,
  pending,
  keepTarget,
  judgePick,
  baseRef,
  onReport,
  onKeep,
  onDiscard,
}: {
  race: Race;
  entrant: Entrant;
  context: RaceBoardContext;
  now: number;
  busy: boolean;
  pending: boolean;
  keepTarget: string | null;
  judgePick: boolean;
  baseRef: string | null;
  onReport: (threadId: string, report: EntrantReport) => void;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const navigate = useNavigate();
  const shell = entrant.thread;
  const threadRef = scopeThreadRef(shell.environmentId, shell.id);
  const { thread, report, phase, working } = useEntrantReport(shell, baseRef);
  const { changes } = report;
  const messages = thread?.messages ?? EMPTY_MESSAGES;
  const lastVisitedAt = useUiStateStore(
    (state) => state.threadLastVisitedAtById[scopedThreadKey(threadRef)],
  );
  const provider = raceEntrantProvider(race, entrant, context);
  const ProviderIcon = provider ? PROVIDER_ICON_BY_PROVIDER[provider.driver] : undefined;
  const pill = resolveThreadStatusPill({ thread: { ...shell, lastVisitedAt } });
  const status = pill
    ? { label: pill.label, colorClass: pill.colorClass, dotClass: pill.dotClass }
    : PHASE_PRESENTATION[phase];

  useEffect(() => {
    onReport(shell.id, report);
  }, [onReport, shell.id, report]);

  const feed = useMemo(
    () =>
      buildRaceEntrantFeed({
        messages: messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          streaming: message.streaming,
          createdAt: message.createdAt,
        })),
        work: deriveWorkLogEntries(thread?.activities ?? []).map((entry) => ({
          id: entry.id,
          createdAt: entry.createdAt,
          label: entry.toolTitle ?? entry.label,
          detail: entry.detail,
          command: entry.command,
          tone: entry.tone,
        })),
      }),
    [messages, thread?.activities],
  );

  const elapsed = raceEntrantElapsedMs(shell.latestTurn, now);
  const fileCount = changes?.files.length ?? null;
  // Keeping an entrant that changed nothing would only discard the others.
  const nothingToKeep = fileCount === 0;
  const keepable = canKeepRaceEntrant(shell) && !nothingToKeep;
  const keepHint = nothingToKeep
    ? "Nothing to keep: this entrant changed no files"
    : keepable
      ? `Merge into ${keepTarget ?? "the project checkout"} and discard the rest`
      : "Available when the entrant finishes";

  return (
    <article
      aria-label={`Entrant ${entrant.slot}: ${raceEntrantLabel(race, entrant, context)}`}
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card/70 shadow-xs transition-[border-color,box-shadow,opacity] duration-200",
        judgePick
          ? "border-amber-400/70 shadow-[0_0_0_1px_var(--color-amber-400)]/20 dark:border-amber-300/50"
          : "border-border/70",
        pending && "opacity-64",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-x-0 top-0 h-0.5", laneAccent(entrant.slot))}
      />
      <header className="flex min-w-0 items-start gap-2.5 px-3.5 pt-3.5 pb-3">
        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {ProviderIcon ? (
            <ProviderIcon className="size-4" />
          ) : (
            <span className="text-xs font-medium">{entrant.slot}</span>
          )}
          <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border border-background bg-foreground text-[9px] font-semibold text-background tabular-nums">
            {entrant.slot}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {provider ? raceProviderLabel(provider) : shell.modelSelection.instanceId}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {raceModelLabel(provider ?? undefined, shell.modelSelection.model)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium",
              status.colorClass,
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                status.dotClass,
                working && "motion-safe:animate-pulse",
              )}
            />
            {status.label}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {formatRaceDuration(elapsed)}
          </span>
        </div>
      </header>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-y border-border/60 bg-muted/20 px-3.5 py-2 text-xs tabular-nums">
        {changes ? (
          <>
            <span className="text-success">+{changes.additions}</span>
            <span className="text-destructive">−{changes.deletions}</span>
            <span className="text-muted-foreground">
              {fileCount} {fileCount === 1 ? "file" : "files"}
            </span>
            {changes.files.some((file) => file.committed) ? (
              <Badge size="sm" variant="secondary">
                committed
              </Badge>
            ) : null}
            {changes.truncated ? (
              <Badge size="sm" variant="warning">
                diff truncated
              </Badge>
            ) : null}
          </>
        ) : report.diffError ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-destructive">
            <TriangleAlertIcon className="size-3.5 shrink-0" />
            <span className="truncate">{report.diffError}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">
            {shell.worktreePath ? "Reading changes…" : "Creating worktree…"}
          </span>
        )}
        {judgePick ? (
          <Badge size="sm" variant="warning" className="ml-auto">
            <CrownIcon /> Judge's pick
          </Badge>
        ) : null}
      </div>

      <EntrantFeed
        items={feed.items}
        hiddenCount={feed.hiddenCount}
        phase={phase}
        cwd={shell.worktreePath ?? undefined}
        threadRef={threadRef}
        sessionError={thread?.session?.lastError ?? null}
      />

      <footer className="mt-auto flex min-w-0 items-center gap-1.5 border-t border-border/60 px-3 py-2.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(threadRef),
            })
          }
        >
          Open <ArrowUpRightIcon />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-label={`Discard entrant ${entrant.slot}`}
          disabled={busy}
          onClick={onDiscard}
        >
          <Trash2Icon /> Discard
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={<span className="ml-auto" />}
            aria-label={keepable ? undefined : keepHint}
          >
            <Button
              size="sm"
              aria-label={`Keep entrant ${entrant.slot}`}
              disabled={busy || !keepable}
              onClick={onKeep}
            >
              <CheckIcon /> {pending ? "Keeping…" : "Keep"}
            </Button>
          </TooltipTrigger>
          <TooltipPopup side="top">{keepHint}</TooltipPopup>
        </Tooltip>
      </footer>
    </article>
  );
}

const FEED_TONE_DOT: Record<string, string> = {
  thinking: "bg-muted-foreground/40",
  tool: "bg-sky-500/70 dark:bg-sky-300/70",
  info: "bg-muted-foreground/50",
  error: "bg-destructive",
};

const EntrantFeed = memo(function EntrantFeed({
  items,
  hiddenCount,
  phase,
  cwd,
  threadRef,
  sessionError,
}: {
  items: ReadonlyArray<RaceFeedItem>;
  hiddenCount: number;
  phase: RaceEntrantPhase;
  cwd: string | undefined;
  threadRef: ReturnType<typeof scopeThreadRef>;
  sessionError: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Follow the stream like a terminal, unless the reader scrolled up to read.
  // Runs after every render; it only moves the scroll position while pinned.
  useEffect(() => {
    const element = scrollRef.current;
    if (element && pinnedRef.current) element.scrollTop = element.scrollHeight;
  });

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      }}
      className="h-80 min-h-0 overflow-y-auto overscroll-contain px-3.5 py-3 sm:h-96"
      aria-live="polite"
      aria-busy={phase === "working"}
    >
      {items.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
          {phase === "failed" ? (
            <>
              <TriangleAlertIcon className="size-4 text-destructive" />
              <p className="text-xs font-medium text-destructive">
                The entrant stopped before it wrote anything
              </p>
              {sessionError ? (
                <p className="line-clamp-4 max-w-xs text-[11px] text-muted-foreground">
                  {sessionError}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <span className="flex gap-1" aria-hidden>
                <span className="size-1.5 rounded-full bg-muted-foreground/40 motion-safe:animate-pulse" />
                <span className="size-1.5 rounded-full bg-muted-foreground/40 motion-safe:animate-pulse [animation-delay:150ms]" />
                <span className="size-1.5 rounded-full bg-muted-foreground/40 motion-safe:animate-pulse [animation-delay:300ms]" />
              </span>
              <p className="text-xs text-muted-foreground">
                {phase === "preparing"
                  ? "Setting up its worktree…"
                  : "Waiting for its first words…"}
              </p>
            </>
          )}
        </div>
      ) : (
        <ol className="flex min-w-0 flex-col gap-2.5">
          {hiddenCount > 0 ? (
            <li className="text-center text-[11px] text-muted-foreground">
              {hiddenCount} earlier {hiddenCount === 1 ? "step" : "steps"} — open the thread for the
              full history
            </li>
          ) : null}
          {items.map((item) =>
            item.kind === "work" ? (
              <li key={item.id} className="flex min-w-0 items-start gap-2 text-xs">
                <span
                  aria-hidden
                  className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", FEED_TONE_DOT[item.tone])}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate font-medium",
                      item.tone === "error" ? "text-destructive" : "text-foreground/80",
                    )}
                  >
                    {item.label}
                  </p>
                  {item.detail ? (
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {item.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            ) : item.role === "assistant" ? (
              <li
                key={item.id}
                className="min-w-0 rounded-lg bg-muted/40 px-2.5 py-2 text-[13px] leading-relaxed"
              >
                <ChatMarkdown
                  text={item.text}
                  cwd={cwd}
                  threadRef={threadRef}
                  isStreaming={item.streaming}
                  className="text-[13px] [&_pre]:text-[11px]"
                />
              </li>
            ) : (
              <li
                key={item.id}
                className="ml-6 min-w-0 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs whitespace-pre-wrap text-muted-foreground"
              >
                {item.text}
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

/** What the arena knows about the judge it is showing, for marking and recording. */
interface RaceJudgeReport {
  readonly threadId: string;
  readonly verdict: RaceJudgeVerdict | null;
  readonly judge: RaceHistoryJudge;
  readonly done: boolean;
}

interface RaceJudgeState {
  readonly candidates: ReadonlyArray<EnvironmentThreadShell>;
  /** The heat being judged; a judge of an earlier heat is not shown. */
  readonly heat: number;
  readonly verdict: RaceJudgeVerdict | null;
  readonly report: RaceJudgeReport | null;
  readonly setReport: (report: RaceJudgeReport | null) => void;
}

function sameJudgeReport(left: RaceJudgeReport | null, right: RaceJudgeReport | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.threadId === right.threadId &&
    left.done === right.done &&
    left.judge.pickSlot === right.judge.pickSlot &&
    left.judge.label === right.judge.label &&
    left.verdict?.kind === right.verdict?.kind
  );
}

/** Judge threads are found by title, then confirmed by their brief's marker. */
function useRaceJudge(race: Race, heat: number): RaceJudgeState {
  const threads = useThreadShells();
  const judgeTitle = buildRaceJudgeTitle(race.titleSeed);
  const candidates = useMemo(
    () =>
      threads
        .filter(
          (thread) =>
            thread.environmentId === race.environmentId &&
            thread.projectId === race.projectId &&
            thread.archivedAt === null &&
            thread.title === judgeTitle,
        )
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [threads, race.environmentId, race.projectId, judgeTitle],
  );
  const [report, setReportState] = useState<RaceJudgeReport | null>(null);
  const setReport = useCallback((next: RaceJudgeReport | null) => {
    setReportState((current) => (sameJudgeReport(current, next) ? current : next));
  }, []);
  return { candidates, heat, verdict: report?.verdict ?? null, report, setReport };
}

function RaceJudgePanel({
  race,
  context,
  judge,
  reports,
  entrantSlots,
  checkoutBranch,
  projectWorkspaceRoot,
  busy,
  onKeep,
}: {
  race: Race;
  context: RaceBoardContext;
  judge: RaceJudgeState;
  reports: ReadonlyMap<string, EntrantReport>;
  entrantSlots: ReadonlyArray<number>;
  checkoutBranch: string | null;
  projectWorkspaceRoot: string | null;
  busy: boolean;
  onKeep: (slot: number) => void;
}) {
  return (
    <section
      aria-label="Judge"
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4"
    >
      <JudgeCandidate
        index={0}
        race={race}
        context={context}
        judge={judge}
        reports={reports}
        entrantSlots={entrantSlots}
        checkoutBranch={checkoutBranch}
        projectWorkspaceRoot={projectWorkspaceRoot}
        busy={busy}
        onKeep={onKeep}
      />
    </section>
  );
}

/**
 * Walks the title matches newest first and shows the first whose brief names
 * this race; with none, offers to start one.
 */
function JudgeCandidate(props: {
  index: number;
  race: Race;
  context: RaceBoardContext;
  judge: RaceJudgeState;
  reports: ReadonlyMap<string, EntrantReport>;
  entrantSlots: ReadonlyArray<number>;
  checkoutBranch: string | null;
  projectWorkspaceRoot: string | null;
  busy: boolean;
  onKeep: (slot: number) => void;
}) {
  const candidate = props.judge.candidates[props.index] ?? null;
  const thread = useThread(
    candidate ? scopeThreadRef(candidate.environmentId, candidate.id) : null,
  );
  if (!candidate) return <JudgeStarter {...props} />;
  if (!thread) {
    return <p className="text-xs text-muted-foreground">Looking for this race's judge…</p>;
  }
  const firstUser = thread.messages.find((message) => message.role === "user");
  if (
    parseRaceJudgeMarker(firstUser?.text) !== props.race.raceId ||
    parseRaceJudgeHeat(firstUser?.text) !== props.judge.heat
  ) {
    return <JudgeCandidate {...props} index={props.index + 1} />;
  }
  return <VerifiedJudge {...props} judgeShell={candidate} judgeThread={thread} />;
}

function VerifiedJudge(
  props: Parameters<typeof JudgeCandidate>[0] & {
    judgeShell: EnvironmentThreadShell;
    judgeThread: NonNullable<ReturnType<typeof useThread>>;
  },
) {
  const [askingAgain, setAskingAgain] = useState(false);
  const judgeDone = raceJudgePhase(props.judgeShell);
  return (
    <>
      <JudgeVerdictView {...props} />
      {askingAgain ? (
        <div className="border-t border-border/60 pt-3">
          <JudgeStarter {...props} secondOpinion />
        </div>
      ) : judgeDone === "done" || judgeDone === "failed" ? (
        <button
          type="button"
          onClick={() => setAskingAgain(true)}
          className="self-start text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          Ask another judge for a second opinion
        </button>
      ) : null}
    </>
  );
}

function JudgeHeading({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-300">
        <GavelIcon className="size-4" />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-medium">Judge</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function JudgeStarter({
  race,
  context,
  judge,
  reports,
  checkoutBranch,
  projectWorkspaceRoot,
  secondOpinion = false,
}: {
  race: Race;
  context: RaceBoardContext;
  judge: RaceJudgeState;
  reports: ReadonlyMap<string, EntrantReport>;
  checkoutBranch: string | null;
  projectWorkspaceRoot: string | null;
  secondOpinion?: boolean;
}) {
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const providers = useMemo(
    () =>
      raceProviders(
        [...context.providersByKey.entries()]
          .filter(([key]) => key.startsWith(`${race.environmentId}\0`))
          .map(([, provider]) => provider),
      ),
    [context.providersByKey, race.environmentId],
  );
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const provider: ServerProvider | undefined =
    providers.find((item) => item.instanceId === instanceId) ?? providers[0];
  const [model, setModel] = useState<string | null>(null);
  const modelSlug =
    (model && provider?.models.some((item) => item.slug === model) ? model : null) ??
    provider?.models[0]?.slug ??
    null;
  const [starting, setStarting] = useState(false);
  const busyRef = useRef(false);

  const phases = race.entrants.map((entrant) => raceEntrantPhase(entrant.thread));
  const allStopped = phases.every((phase) => phase === "finished" || phase === "failed");
  const loaded = race.entrants.every((entrant) => reports.get(entrant.thread.id)?.changes);
  const anyChanges = race.entrants.some(
    (entrant) => (reports.get(entrant.thread.id)?.changes?.files.length ?? 0) > 0,
  );
  const blocker = !allStopped
    ? "Available when every entrant has stopped."
    : !loaded
      ? "Reading every entrant's changes…"
      : !anyChanges
        ? "No entrant changed any files, so there is nothing to judge."
        : !projectWorkspaceRoot
          ? "The race's project is not available on this computer."
          : !provider || !modelSlug
            ? "No ready agent can judge on this computer."
            : null;

  async function startJudge() {
    if (blocker || busyRef.current || !provider || !modelSlug) return;
    busyRef.current = true;
    setStarting(true);
    const createdAt = new Date().toISOString();
    const threadId = newThreadId();
    const modelSelection: ModelSelection = { instanceId: provider.instanceId, model: modelSlug };
    const brief = buildRaceJudgeBrief({
      raceId: race.raceId,
      heat: judge.heat,
      prompt:
        race.entrants
          .map((entrant) => reports.get(entrant.thread.id)?.prompt)
          .find((text): text is string => typeof text === "string" && text.trim().length > 0) ??
        race.titleSeed,
      entrants: race.entrants.map((entrant) => {
        const report = reports.get(entrant.thread.id);
        return {
          slot: entrant.slot,
          label: raceEntrantLabel(race, entrant, context),
          branch: entrant.thread.branch,
          worktreePath: entrant.thread.worktreePath,
          phase: PHASE_PRESENTATION[raceEntrantPhase(entrant.thread)].label.toLowerCase(),
          files: (report?.changes?.files ?? []).map((file) => ({
            path: file.path,
            additions: file.additions,
            deletions: file.deletions,
          })),
          diff: report?.diffText ?? "",
          finalMessage: report?.finalMessage ?? null,
        };
      }),
    });
    try {
      // A judge plans instead of editing: plan mode keeps it read-only on
      // providers that honor it, and the brief says so for the rest.
      const result = await startTurn({
        environmentId: race.environmentId,
        input: {
          threadId,
          message: { messageId: newMessageId(), role: "user", text: brief, attachments: [] },
          modelSelection,
          titleSeed: race.titleSeed,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: "plan",
          bootstrap: {
            createThread: {
              projectId: race.projectId,
              title: buildRaceJudgeTitle(race.titleSeed),
              modelSelection,
              runtimeMode: DEFAULT_RUNTIME_MODE,
              interactionMode: "plan",
              branch: checkoutBranch,
              worktreePath: null,
              createdAt,
            },
          },
          createdAt,
        },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "The judge could not start",
            description:
              error instanceof Error ? error.message : "The judge thread failed to start.",
          });
        }
        return;
      }
      await waitForThreadShell(scopeThreadRef(race.environmentId, threadId)).catch(() => null);
    } finally {
      busyRef.current = false;
      setStarting(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      {secondOpinion ? (
        <p className="text-xs text-muted-foreground">
          A second judge gets the same brief. Its verdict replaces this one here; both threads stay
          in the sidebar.
        </p>
      ) : (
        <JudgeHeading subtitle="Another agent reads every entrant's diff, runs read-only checks, and names the one to keep. It cannot change any worktree." />
      )}
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:w-[26rem]">
          <RaceSelect
            ariaLabel="Judge provider"
            value={provider?.instanceId ?? ""}
            disabled={providers.length === 0 || starting}
            placeholder="No agent"
            options={providers.map((item) => {
              const Icon = PROVIDER_ICON_BY_PROVIDER[item.driver];
              return {
                value: item.instanceId,
                label: raceProviderLabel(item),
                icon: Icon ? <Icon className="size-3.5" /> : undefined,
              };
            })}
            onChange={(value) => {
              setInstanceId(value);
              setModel(null);
            }}
          />
          <RaceSelect
            ariaLabel="Judge model"
            value={modelSlug ?? ""}
            disabled={!provider || starting}
            placeholder="No model"
            options={(provider?.models ?? []).map((item) => ({
              value: item.slug,
              label: raceModelLabel(provider, item.slug),
            }))}
            onChange={setModel}
          />
        </div>
        <Tooltip>
          <TooltipTrigger render={<span className="shrink-0" />}>
            <Button
              size="sm"
              disabled={blocker !== null || starting}
              onClick={() => void startJudge()}
              className="w-full sm:w-auto"
            >
              <GavelIcon /> {starting ? "Starting…" : "Ask the judge"}
            </Button>
          </TooltipTrigger>
          {blocker ? <TooltipPopup side="top">{blocker}</TooltipPopup> : null}
        </Tooltip>
      </div>
      {blocker ? <p className="text-[11px] text-muted-foreground lg:hidden">{blocker}</p> : null}
    </div>
  );
}

const JUDGE_PHASE_PRESENTATION: Record<
  RaceJudgePhase,
  { readonly label: string; readonly colorClass: string; readonly dotClass: string }
> = {
  starting: { label: "Starting", ...pick(PHASE_PRESENTATION.preparing) },
  judging: { label: "Judging", ...pick(PHASE_PRESENTATION.working) },
  attention: { label: "Needs you", ...pick(PHASE_PRESENTATION.attention) },
  failed: { label: "Failed", ...pick(PHASE_PRESENTATION.failed) },
  done: { label: "Verdict in", ...pick(PHASE_PRESENTATION.finished) },
};

function pick(view: { readonly colorClass: string; readonly dotClass: string }) {
  return { colorClass: view.colorClass, dotClass: view.dotClass };
}

function JudgeVerdictView({
  race,
  context,
  judge,
  entrantSlots,
  busy,
  onKeep,
  judgeShell,
  judgeThread,
}: {
  race: Race;
  context: RaceBoardContext;
  judge: RaceJudgeState;
  entrantSlots: ReadonlyArray<number>;
  busy: boolean;
  onKeep: (slot: number) => void;
  judgeShell: EnvironmentThreadShell;
  judgeThread: NonNullable<ReturnType<typeof useThread>>;
}) {
  const navigate = useNavigate();
  const judgeRef = scopeThreadRef(judgeShell.environmentId, judgeShell.id);
  const provider =
    context.providersByKey.get(`${race.environmentId}\0${judgeShell.modelSelection.instanceId}`) ??
    undefined;
  const phase = raceJudgePhase(judgeShell);
  const working = phase === "judging" || phase === "starting";
  const phaseView = JUDGE_PHASE_PRESENTATION[phase];
  const assistant = judgeThread.messages.filter((message) => message.role === "assistant");
  const plan = judgeThread.proposedPlans.at(-1)?.planMarkdown ?? null;
  const latest = assistant.at(-1) ?? null;
  // Plan mode on some providers answers with a proposed plan instead of a message.
  const answer =
    plan && (!latest || (judgeThread.proposedPlans.at(-1)?.updatedAt ?? "") > latest.updatedAt)
      ? plan
      : (latest?.text ?? null);
  const verdict = useMemo(
    () => parseRaceJudgeVerdict(answer, entrantSlots),
    [answer, entrantSlots],
  );
  const { setReport } = judge;
  const done = phase === "done";
  const pickSlot = verdict?.kind === "winner" ? verdict.slot : null;
  const hasVerdict = verdict !== null;
  const judgeLabel = formatRaceAgentLabel(provider, judgeShell.modelSelection);
  const judgeInstanceId = judgeShell.modelSelection.instanceId;
  const judgeModel = judgeShell.modelSelection.model;
  const judgeDriver = provider?.driver ?? judgeInstanceId;
  useEffect(() => {
    setReport({
      threadId: judgeShell.id,
      verdict:
        pickSlot !== null
          ? { kind: "winner", slot: pickSlot }
          : hasVerdict
            ? { kind: "none" }
            : null,
      judge: {
        instanceId: judgeInstanceId,
        driver: judgeDriver,
        model: judgeModel,
        label: judgeLabel,
        pickSlot,
      },
      done,
    });
  }, [
    setReport,
    judgeShell.id,
    judgeInstanceId,
    judgeModel,
    judgeDriver,
    judgeLabel,
    pickSlot,
    hasVerdict,
    done,
  ]);
  useEffect(() => () => setReport(null), [setReport]);
  const winner =
    verdict?.kind === "winner"
      ? (race.entrants.find((entrant) => entrant.slot === verdict.slot) ?? null)
      : null;
  const ProviderIcon = provider ? PROVIDER_ICON_BY_PROVIDER[provider.driver] : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <JudgeHeading
          subtitle={`${formatRaceAgentLabel(provider, judgeShell.modelSelection)} · asked ${formatRelativeTimeLabel(judgeShell.createdAt)}`}
        />
        <div className="flex shrink-0 items-center gap-1.5">
          {ProviderIcon ? <ProviderIcon className="size-3.5 text-muted-foreground" /> : null}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium",
              phaseView.colorClass,
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                phaseView.dotClass,
                working && "motion-safe:animate-pulse",
              )}
            />
            {phaseView.label}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(judgeRef),
              })
            }
          >
            Open <ArrowUpRightIcon />
          </Button>
        </div>
      </div>

      {verdict ? (
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-3 rounded-xl border px-3.5 py-3",
            verdict.kind === "winner"
              ? "border-amber-400/50 bg-amber-500/8 dark:border-amber-300/30"
              : "border-border bg-muted/40",
          )}
        >
          <CrownIcon
            className={cn(
              "size-4 shrink-0",
              verdict.kind === "winner"
                ? "text-amber-600 dark:text-amber-300"
                : "text-muted-foreground",
            )}
          />
          <p className="min-w-0 flex-1 text-sm">
            {winner ? (
              <>
                The judge picks <span className="font-semibold">Entrant {winner.slot}</span> —{" "}
                {raceEntrantLabel(race, winner, context)}
              </>
            ) : verdict.kind === "winner" ? (
              <>The judge picked Entrant {verdict.slot}, which is no longer in this race.</>
            ) : (
              <>The judge would keep none of the entrants.</>
            )}
          </p>
          {winner ? (
            <Button
              size="sm"
              disabled={busy || !canKeepRaceEntrant(winner.thread)}
              onClick={() => onKeep(winner.slot)}
            >
              <CheckIcon /> Keep Entrant {winner.slot}
            </Button>
          ) : null}
        </div>
      ) : null}

      {answer ? (
        <div className="max-h-96 min-w-0 overflow-y-auto rounded-xl bg-muted/30 px-3.5 py-3 text-[13px] leading-relaxed">
          <ChatMarkdown
            text={answer}
            cwd={undefined}
            threadRef={judgeRef}
            isStreaming={latest?.streaming === true}
            className="text-[13px]"
          />
        </div>
      ) : phase === "failed" ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlertIcon className="size-3.5" />
          {judgeThread.session?.lastError ?? "The judge stopped before it answered."}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          The judge is reading the entrants' work. Its verdict appears here as it writes.
        </p>
      )}
      {!working && !verdict && answer ? (
        <p className="text-[11px] text-muted-foreground">
          The judge did not end with a “Winner: Entrant N” line, so no entrant is marked. Read its
          notes and keep one yourself.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Changes compared
// ---------------------------------------------------------------------------

function splitPath(path: string): { dir: string; base: string } {
  const index = path.lastIndexOf("/");
  return index === -1
    ? { dir: "", base: path }
    : { dir: path.slice(0, index + 1), base: path.slice(index + 1) };
}

function ChurnBar({
  additions,
  deletions,
  max,
}: {
  additions: number;
  deletions: number;
  max: number;
}) {
  const total = additions + deletions;
  const width = max > 0 ? Math.max(6, Math.round((total / max) * 100)) : 0;
  return (
    <span aria-hidden className="flex h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-muted">
      <span className="flex h-full" style={{ width: `${width}%` }}>
        <span className="h-full bg-success" style={{ flexGrow: additions || 0 }} />
        <span className="h-full bg-destructive" style={{ flexGrow: deletions || 0 }} />
      </span>
    </span>
  );
}

const CHANGE_LABEL: Record<EntrantFile["change"], string> = {
  added: "new",
  deleted: "deleted",
  renamed: "renamed",
  modified: "",
};

function RaceChangesMatrix({
  race,
  context,
  matrix,
  reports,
  expandedPath,
  onToggle,
}: {
  race: Race;
  context: RaceBoardContext;
  matrix: ReturnType<typeof buildRaceFileMatrix<EntrantFile>>;
  reports: ReadonlyMap<string, EntrantReport>;
  expandedPath: string | null;
  onToggle: (path: string) => void;
}) {
  const maxChurn = matrix.rows.reduce(
    (max, row) =>
      Math.max(max, ...row.cells.map((cell) => (cell ? cell.additions + cell.deletions : 0))),
    0,
  );
  const loadedCount = race.entrants.filter(
    (entrant) => reports.get(entrant.thread.id)?.changes,
  ).length;
  const columns = `minmax(12rem,1.6fr) repeat(${race.entrants.length}, minmax(7.5rem,1fr))`;

  return (
    <section aria-label="Changes compared" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <FileDiffIcon className="size-4 text-muted-foreground" />
          Changes compared
          {matrix.rows.length > 0 ? (
            <span className="text-muted-foreground tabular-nums">{matrix.rows.length}</span>
          ) : null}
        </h3>
        {matrix.rows.length > 0 && race.entrants.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            {matrix.sharedCount > 0
              ? `${matrix.sharedCount} ${matrix.sharedCount === 1 ? "file" : "files"} touched by every entrant with changes`
              : "No file is touched by every entrant"}
            {race.entrants
              .map((entrant, index) =>
                matrix.uniqueCounts[index]
                  ? ` · ${matrix.uniqueCounts[index]} only by #${entrant.slot}`
                  : "",
              )
              .join("")}
          </p>
        ) : null}
      </div>

      {matrix.rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {loadedCount < race.entrants.length
            ? "Reading each entrant's worktree…"
            : "No entrant has changed a file yet. Files appear here as soon as an entrant writes them."}
        </p>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-2xl border border-border/70 bg-card/60">
          <div role="table" aria-label="Files changed by each entrant" className="min-w-max">
            <div
              role="row"
              className="sticky top-0 grid items-center gap-3 border-b border-border/70 bg-muted/30 px-3.5 py-2 text-[11px] font-medium text-muted-foreground"
              style={{ gridTemplateColumns: columns }}
            >
              <span role="columnheader">File</span>
              {race.entrants.map((entrant) => (
                <span
                  key={entrant.thread.id}
                  role="columnheader"
                  className="flex min-w-0 items-center gap-1.5"
                >
                  <span
                    aria-hidden
                    className={cn("size-2 shrink-0 rounded-full", laneAccent(entrant.slot))}
                  />
                  <span className="truncate">
                    #{entrant.slot}{" "}
                    {raceModelLabel(
                      raceEntrantProvider(race, entrant, context) ?? undefined,
                      entrant.thread.modelSelection.model,
                    )}
                  </span>
                </span>
              ))}
            </div>
            {matrix.rows.map((row) => {
              const expanded = expandedPath === row.path;
              const { dir, base } = splitPath(row.path);
              return (
                <div
                  key={row.path}
                  role="rowgroup"
                  className="border-b border-border/50 last:border-b-0"
                >
                  <button
                    type="button"
                    role="row"
                    aria-expanded={expanded}
                    onClick={() => onToggle(row.path)}
                    className={cn(
                      "grid w-full items-center gap-3 px-3.5 py-2 text-left text-xs transition-colors hover:bg-accent/50 focus-visible:bg-accent/60 focus-visible:outline-none",
                      expanded && "bg-accent/40",
                    )}
                    style={{ gridTemplateColumns: columns }}
                  >
                    <span role="cell" className="flex min-w-0 items-center gap-1.5">
                      <ChevronRightIcon
                        aria-hidden
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                          expanded && "rotate-90",
                        )}
                      />
                      <span className="min-w-0 truncate font-mono text-[12px]">
                        <span className="text-muted-foreground">{dir}</span>
                        <span className="text-foreground">{base}</span>
                      </span>
                      {row.touchedBy === race.entrants.length && race.entrants.length > 1 ? (
                        <Badge size="sm" variant="secondary" className="shrink-0">
                          all
                        </Badge>
                      ) : null}
                    </span>
                    {row.cells.map((cell, index) => (
                      <span
                        key={race.entrants[index]!.thread.id}
                        role="cell"
                        className="flex min-w-0 flex-col gap-1"
                      >
                        {cell ? (
                          <>
                            <span className="flex items-baseline gap-1.5 tabular-nums">
                              <span className="text-success">+{cell.additions}</span>
                              <span className="text-destructive">−{cell.deletions}</span>
                              {CHANGE_LABEL[cell.change] ? (
                                <span className="text-[10px] text-muted-foreground">
                                  {CHANGE_LABEL[cell.change]}
                                </span>
                              ) : null}
                            </span>
                            <ChurnBar
                              additions={cell.additions}
                              deletions={cell.deletions}
                              max={maxChurn}
                            />
                          </>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </span>
                    ))}
                  </button>
                  {expanded ? (
                    <FileComparison
                      race={race}
                      context={context}
                      cells={row.cells}
                      path={row.path}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function FileComparison({
  race,
  context,
  cells,
  path,
}: {
  race: Race;
  context: RaceBoardContext;
  cells: ReadonlyArray<EntrantFile | null>;
  path: string;
}) {
  const { resolvedTheme } = useTheme();
  return (
    <div
      className={cn(
        "grid gap-3 border-t border-border/50 bg-background/60 p-3",
        race.entrants.length >= 3 ? "xl:grid-cols-3" : "lg:grid-cols-2",
      )}
      style={{ width: "min(100%, calc(100vw - 4rem))", position: "sticky", left: 0 }}
    >
      <DiffWorkerPoolProvider>
        {race.entrants.map((entrant, index) => {
          const cell = cells[index] ?? null;
          const renderable = cell
            ? getRenderablePatch(cell.patch, `race-arena:${entrant.thread.id}:${path}`)
            : null;
          return (
            <div
              key={entrant.thread.id}
              className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card"
            >
              <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs">
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-full", laneAccent(entrant.slot))}
                />
                <span className="truncate font-medium">
                  #{entrant.slot} {raceEntrantLabel(race, entrant, context)}
                </span>
                {cell ? (
                  <span className="ml-auto shrink-0 tabular-nums">
                    <span className="text-success">+{cell.additions}</span>{" "}
                    <span className="text-destructive">−{cell.deletions}</span>
                  </span>
                ) : null}
              </div>
              {!cell ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  This entrant left the file unchanged.
                </p>
              ) : cell.binary ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Binary change — open the thread to inspect it.
                </p>
              ) : renderable?.kind === "files" ? (
                <div className="max-h-[32rem] min-w-0 overflow-auto text-[12px]">
                  {renderable.files.map((fileDiff) => (
                    <FileDiff
                      key={fileDiff.cacheKey ?? fileDiff.name}
                      fileDiff={fileDiff}
                      options={{
                        collapsed: false,
                        diffStyle: "unified",
                        theme: resolveDiffThemeName(resolvedTheme),
                        preferredHighlighter: PREFERRED_HIGHLIGHTER,
                      }}
                    />
                  ))}
                </div>
              ) : (
                <pre className="max-h-[32rem] overflow-auto px-3 py-2 font-mono text-[11px] whitespace-pre">
                  {cell.patch}
                </pre>
              )}
            </div>
          );
        })}
      </DiffWorkerPoolProvider>
    </div>
  );
}
