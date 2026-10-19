/* agent-watermark: model=opus-5.5; effort=high; duration=45m; seat=claude-code; date=2026-10-19 */
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProviderDriverKind,
  RaceHistoryRecord,
  RaceTaskKind,
} from "@t3tools/contracts";
import {
  buildRaceKindLeaders,
  buildRaceLeaderboard,
  RACE_TASK_KIND_LABELS,
  type RaceLeaderboardRow,
} from "@t3tools/shared/raceHistory";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  CircleSlashIcon,
  CrownIcon,
  GavelIcon,
  Trash2Icon,
  TriangleAlertIcon,
  TrophyIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { raceHistoryEnvironment } from "../../state/raceHistory";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { RaceSelect } from "./RaceComposer";
import { formatRaceCost, formatRaceDuration } from "./raceArena.logic";

interface ScoreboardRecord extends RaceHistoryRecord {
  readonly environmentId: EnvironmentId;
}

interface EnvironmentRef {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
}

interface EnvironmentHistoryState {
  readonly records: ReadonlyArray<RaceHistoryRecord> | null;
  readonly error: string | null;
}

const KIND_OPTIONS = (Object.keys(RACE_TASK_KIND_LABELS) as RaceTaskKind[]).map((kind) => ({
  value: kind,
  label: RACE_TASK_KIND_LABELS[kind],
}));

function AgentIcon({ driver, className }: { driver: string; className?: string }) {
  const Icon = PROVIDER_ICON_BY_PROVIDER[driver as ProviderDriverKind];
  return Icon ? (
    <Icon className={cn("size-4", className)} />
  ) : (
    <span className={cn("size-4 rounded-full bg-muted-foreground/30", className)} />
  );
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

/** Reads one computer's race history and hands it up; one per connected computer. */
function EnvironmentHistory({
  environmentId,
  onRecords,
}: {
  environmentId: EnvironmentId;
  onRecords: (environmentId: EnvironmentId, state: EnvironmentHistoryState) => void;
}) {
  const query = useEnvironmentQuery(raceHistoryEnvironment.list({ environmentId, input: {} }));
  const records = query.data?.records ?? null;
  useEffect(() => {
    onRecords(environmentId, { records, error: query.error });
  }, [environmentId, onRecords, records, query.error]);
  return null;
}

export function RaceScoreboard({
  environments,
  liveRaceKeys,
}: {
  environments: ReadonlyArray<EnvironmentRef>;
  /** `${environmentId}\0${raceId}` of races whose entrants still exist. */
  liveRaceKeys: ReadonlySet<string>;
}) {
  const [byEnvironment, setByEnvironment] = useState<ReadonlyMap<string, EnvironmentHistoryState>>(
    () => new Map(),
  );
  const onRecords = useCallback((environmentId: EnvironmentId, state: EnvironmentHistoryState) => {
    setByEnvironment((current) => {
      const previous = current.get(environmentId);
      if (previous && previous.records === state.records && previous.error === state.error) {
        return current;
      }
      const next = new Map(current);
      next.set(environmentId, state);
      return next;
    });
  }, []);
  const connected = useMemo(
    () => environments.filter((environment) => environment.connected),
    [environments],
  );
  const records = useMemo<ScoreboardRecord[]>(
    () =>
      connected
        .flatMap((environment) =>
          (byEnvironment.get(environment.environmentId)?.records ?? []).map((record) => ({
            ...record,
            environmentId: environment.environmentId,
          })),
        )
        .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt)),
    [byEnvironment, connected],
  );
  // No computer connected yet reads as "waiting", never as an empty history.
  const waitingForConnection = connected.length === 0;
  const loading =
    waitingForConnection ||
    connected.some((environment) => {
      const state = byEnvironment.get(environment.environmentId);
      return state === undefined || (state.records === null && state.error === null);
    });
  const errors = connected.flatMap((environment) => {
    const error = byEnvironment.get(environment.environmentId)?.error;
    return error ? [{ label: environment.label, error }] : [];
  });

  const [kind, setKind] = useState<RaceTaskKind | null>(null);
  const kindsPresent = (Object.keys(RACE_TASK_KIND_LABELS) as RaceTaskKind[]).filter((item) =>
    records.some((record) => record.taskKind === item),
  );
  const filtered = useMemo(
    () => (kind ? records.filter((record) => record.taskKind === kind) : records),
    [kind, records],
  );
  const board = useMemo(() => buildRaceLeaderboard(filtered), [filtered]);
  const leaders = useMemo(() => buildRaceKindLeaders(records), [records]);
  const decided = filtered.filter((record) => record.outcome !== "open");
  const judgedAndKept = filtered.filter(
    (record) => record.outcome === "kept" && record.judge && record.judge.pickSlot !== null,
  );
  const judgeAgreement =
    judgedAndKept.length > 0
      ? judgedAndKept.filter((record) => record.judge?.pickSlot === record.keptSlot).length /
        judgedAndKept.length
      : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {connected.map((environment) => (
        <EnvironmentHistory
          key={environment.environmentId}
          environmentId={environment.environmentId}
          onRecords={onRecords}
        />
      ))}

      {errors.map((item) => (
        <p
          key={item.label}
          className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/6 px-3.5 py-2.5 text-xs text-destructive"
        >
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          {item.label}: {item.error}
        </p>
      ))}

      {records.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <TrophyIcon className="size-5" />
          </span>
          <h3 className="text-sm font-medium">
            {waitingForConnection
              ? environments.length === 0
                ? "No computer to read race history from"
                : "Waiting for a computer to connect…"
              : loading
                ? "Reading race history…"
                : "No finished races yet"}
          </h3>
          {!loading ? (
            <p className="max-w-md text-xs text-muted-foreground">
              Every race you finish lands here: the judge's verdict, the entrant you kept, and how
              long each agent took. Keep a winner in a race's arena, or close it with “No winner”,
              and the scoreboard starts counting.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <section
            aria-label="Scoreboard summary"
            className="flex min-w-0 flex-wrap items-center justify-between gap-3"
          >
            <div
              className="flex min-w-0 flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Kind of task"
            >
              <KindChip
                label="All tasks"
                active={kind === null}
                count={records.length}
                onClick={() => setKind(null)}
              />
              {kindsPresent.map((item) => (
                <KindChip
                  key={item}
                  label={RACE_TASK_KIND_LABELS[item]}
                  active={kind === item}
                  count={records.filter((record) => record.taskKind === item).length}
                  onClick={() => setKind(kind === item ? null : item)}
                />
              ))}
            </div>
            <dl className="flex items-stretch divide-x divide-border overflow-hidden rounded-xl border border-border/70 bg-card/60 text-xs">
              <Stat label="Races" value={String(filtered.length)} />
              <Stat label="Decided" value={String(decided.length)} />
              <Stat label="Agents" value={String(board.length)} />
              <Stat
                label="Judge agreed"
                value={percent(judgeAgreement)}
                hint={
                  judgeAgreement === null
                    ? "No kept race had a judge's pick yet"
                    : `Of ${judgedAndKept.length} kept races with a judge's pick`
                }
              />
            </dl>
          </section>

          {kind === null && leaders.length > 0 ? (
            <section aria-label="Who wins what" className="flex min-w-0 flex-col gap-2">
              <h3 className="text-sm font-medium">Who wins what</h3>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {leaders.map((item) => (
                  <button
                    key={item.taskKind}
                    type="button"
                    onClick={() => setKind(item.taskKind)}
                    className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-card/60 px-3.5 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      {item.leader ? (
                        <AgentIcon driver={item.leader.driver} />
                      ) : (
                        <CircleSlashIcon className="size-4 text-muted-foreground" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                        {RACE_TASK_KIND_LABELS[item.taskKind]}
                      </span>
                      <span className="block truncate text-sm font-medium">
                        {item.leader?.label ?? "No winner yet"}
                      </span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {item.leader
                          ? `${item.leader.wins} of ${item.decided} decided ${item.decided === 1 ? "race" : "races"}`
                          : `${item.decided} decided, none kept`}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section aria-label="Leaderboard" className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-medium">
                Leaderboard{kind ? ` · ${RACE_TASK_KIND_LABELS[kind]}` : ""}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Keep rate counts decided races only. Cost is what the provider reported.
              </p>
            </div>
            <LeaderboardTable rows={board} />
          </section>

          <section aria-label="Race history" className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium">
              History
              <span className="ml-1.5 text-muted-foreground tabular-nums">{filtered.length}</span>
            </h3>
            <ol className="flex min-w-0 flex-col divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card/60">
              {filtered.map((record) => (
                <HistoryRow
                  key={`${record.environmentId}\0${record.raceId}`}
                  record={record}
                  live={liveRaceKeys.has(`${record.environmentId}\0${record.raceId}`)}
                />
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}

function KindChip({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
        active
          ? "border-foreground/20 bg-foreground text-background"
          : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <span
        className={cn("tabular-nums", active ? "text-background/70" : "text-muted-foreground/70")}
      >
        {count}
      </span>
    </button>
  );
}

/** A short explanation on hover, in the app's own tooltip. */
function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex min-w-0 items-center" />}>
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{text}</TooltipPopup>
    </Tooltip>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const body = <dd className="text-sm font-medium tabular-nums">{value}</dd>;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3.5 py-2">
      <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      {hint ? <Hint text={hint}>{body}</Hint> : body}
    </div>
  );
}

function LeaderboardTable({ rows }: { rows: ReadonlyArray<RaceLeaderboardRow> }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
        No races of this kind yet.
      </p>
    );
  }
  return (
    <div className="min-w-0 overflow-x-auto rounded-2xl border border-border/70 bg-card/60">
      <table className="w-full min-w-[44rem] text-xs">
        <thead>
          <tr className="border-b border-border/70 bg-muted/30 text-left text-[11px] text-muted-foreground">
            <th className="w-8 px-3.5 py-2 font-medium">#</th>
            <th className="px-2 py-2 font-medium">Agent</th>
            <th className="px-2 py-2 text-right font-medium">Races</th>
            <th className="px-2 py-2 text-right font-medium">Wins</th>
            <th className="w-40 px-2 py-2 font-medium">Keep rate</th>
            <th className="px-2 py-2 text-right font-medium">Judge picks</th>
            <th className="px-2 py-2 text-right font-medium">Median time</th>
            <th className="px-2 py-2 text-right font-medium">Median cost</th>
            <th className="px-3.5 py-2 text-right font-medium">Failed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} className="border-b border-border/50 last:border-b-0">
              <td className="px-3.5 py-2.5 text-muted-foreground tabular-nums">
                {index === 0 && row.wins > 0 ? (
                  <CrownIcon
                    className="size-3.5 text-amber-500 dark:text-amber-300"
                    aria-label="Leader"
                  />
                ) : (
                  index + 1
                )}
              </td>
              <td className="px-2 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <AgentIcon driver={row.driver} className="shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{row.label}</span>
                </span>
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums">{row.races}</td>
              <td className="px-2 py-2.5 text-right font-medium tabular-nums">{row.wins}</td>
              <td className="px-2 py-2.5">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
                      style={{ width: `${Math.round((row.keepRate ?? 0) * 100)}%` }}
                    />
                  </span>
                  <Hint text={`${row.wins} of ${row.decided} decided`}>
                    <span className="tabular-nums">{percent(row.keepRate)}</span>
                  </Hint>
                </span>
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums">{row.judgePicks}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">
                {formatRaceDuration(row.medianMs)}
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums">
                <Hint
                  text={
                    row.costReports === 0
                      ? "This provider reported no cost"
                      : `From ${row.costReports} of ${row.races} races`
                  }
                >
                  {formatRaceCost(row.medianCostUsd)}
                </Hint>
              </td>
              <td
                className={cn(
                  "px-3.5 py-2.5 text-right tabular-nums",
                  row.failures > 0 && "text-destructive",
                )}
              >
                {row.failures}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryRow({ record, live }: { record: ScoreboardRecord; live: boolean }) {
  const navigate = useNavigate();
  const recordResult = useAtomCommand(raceHistoryEnvironment.record, { reportFailure: false });
  const forget = useAtomCommand(raceHistoryEnvironment.forget, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const kept =
    record.outcome === "kept"
      ? (record.entrants.find((entrant) => entrant.slot === record.keptSlot) ?? null)
      : null;

  const changeKind = async (taskKind: RaceTaskKind) => {
    const { recordedAt: _recordedAt, environmentId: _environmentId, ...input } = record;
    const result = await recordResult({
      environmentId: record.environmentId,
      input: { ...input, taskKind, taskKindSource: "user" },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not change the kind of task",
        description: error instanceof Error ? error.message : "Race history did not save.",
      });
    }
  };

  const forgetRecord = async () => {
    const localApi = readLocalApi();
    if (!localApi) return;
    const confirmed = await settlePromise(() =>
      localApi.dialogs.confirm(
        `Remove "${record.titleSeed}" from race history?\nThe scoreboard stops counting it. Threads and code are not touched.`,
        { variant: "destructive" },
      ),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    setBusy(true);
    try {
      const result = await forget({
        environmentId: record.environmentId,
        input: { raceId: record.raceId },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not remove the race",
          description: error instanceof Error ? error.message : "Race history did not save.",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={cn("flex min-w-0 flex-col gap-2.5 px-3.5 py-3", busy && "opacity-64")}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
          <p className="truncate text-sm font-medium">{record.titleSeed || "Untitled race"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {record.projectTitle || "Unknown project"} · {formatRelativeTimeLabel(record.startedAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {record.outcome === "kept" ? (
            <Badge variant="success">
              <TrophyIcon /> Kept #{record.keptSlot}
            </Badge>
          ) : record.outcome === "none" ? (
            <Badge variant="secondary">
              <CircleSlashIcon /> No winner
            </Badge>
          ) : (
            <Badge variant="info">Undecided</Badge>
          )}
          <div className="w-28">
            <RaceSelect
              ariaLabel={`Kind of task for ${record.titleSeed}`}
              value={record.taskKind}
              options={KIND_OPTIONS}
              onChange={(value) => void changeKind(value as RaceTaskKind)}
            />
          </div>
          {live ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Open the arena"
              onClick={() =>
                void navigate({
                  to: "/race",
                  search: { race: record.raceId, env: record.environmentId },
                })
              }
            >
              <ArrowUpRightIcon />
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label={`Remove ${record.titleSeed} from history`}
            disabled={busy}
            onClick={() => void forgetRecord()}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <ul className="flex min-w-0 flex-wrap gap-1.5">
        {record.entrants.map((entrant) => {
          const winner = kept?.slot === entrant.slot;
          const picked = record.judge?.pickSlot === entrant.slot;
          return (
            <li
              key={entrant.slot}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1 text-[11px]",
                winner
                  ? "border-emerald-500/40 bg-emerald-500/8"
                  : entrant.phase === "failed"
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-border/70 bg-background/50",
              )}
            >
              <AgentIcon driver={entrant.driver} className="size-3.5 shrink-0" />
              <span className="truncate font-medium">{entrant.label}</span>
              {entrant.phase === "failed" ? (
                entrant.failure ? (
                  <Hint text={entrant.failure}>
                    <span className="text-destructive">failed</span>
                  </Hint>
                ) : (
                  <span className="text-destructive">failed</span>
                )
              ) : (
                <span className="text-muted-foreground tabular-nums">
                  <span className="text-success">+{entrant.additions}</span>{" "}
                  <span className="text-destructive">−{entrant.deletions}</span> ·{" "}
                  {formatRaceDuration(entrant.elapsedMs)}
                  {entrant.costUsd !== null ? ` · ${formatRaceCost(entrant.costUsd)}` : ""}
                </span>
              )}
              {picked ? (
                <GavelIcon
                  className="size-3 text-amber-600 dark:text-amber-300"
                  aria-label="Judge's pick"
                />
              ) : null}
              {winner ? (
                <CrownIcon
                  className="size-3 text-emerald-600 dark:text-emerald-300"
                  aria-label="Kept"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {record.judge ? (
        <p className="text-[11px] text-muted-foreground">
          Judged by {record.judge.label}:{" "}
          {record.judge.pickSlot !== null ? `picked #${record.judge.pickSlot}` : "would keep none"}
          {record.outcome === "kept" && record.judge.pickSlot !== null
            ? record.judge.pickSlot === record.keptSlot
              ? " — you agreed"
              : " — you kept another"
            : ""}
        </p>
      ) : null}
    </li>
  );
}
