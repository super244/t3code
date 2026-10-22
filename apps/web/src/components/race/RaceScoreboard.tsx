/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=45m; seat=codex; date=2026-10-21 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-20 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=9m; seat=codex; date=2026-10-19 */
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
  RaceHistoryOutcome,
} from "@t3tools/contracts";
import {
  buildRaceKindLeaders,
  buildRaceMatchups,
  buildRaceLadder,
  buildRaceLeaderboard,
  RACE_LADDER_PROVISIONAL_GAMES,
  RACE_LADDER_START_RATING,
  RACE_TASK_KIND_LABELS,
  queryRaceHistory,
  raceHistoryCsv,
  raceEvidenceMarkdown,
  raceContainsPair,
  type RaceMatchup,
  buildRacePromptRuns,
  raceAgentKey,
  racePromptKey,
  raceHeats,
  type RaceLadderRow,
  type RaceLeaderboardRow,
} from "@t3tools/shared/raceHistory";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  CircleSlashIcon,
  CrownIcon,
  DownloadIcon,
  SearchIcon,
  RefreshCwIcon,
  GavelIcon,
  SwordsIcon,
  Trash2Icon,
  TriangleAlertIcon,
  TrophyIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSnapshotAtom } from "../../state/shell";
import { raceHistoryEnvironment } from "../../state/raceHistory";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { RaceMatchups } from "./RaceMatchups";
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
  readonly isPending: boolean;
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

/** Keep prepared bytes alive while a browser or Electron save dialog consumes them. */
function usePreparedRaceDownload() {
  const url = useRef<string | null>(null);
  const [prepared, setPrepared] = useState<{ href: string; filename: string } | null>(null);
  useEffect(
    () => () => {
      if (url.current !== null) URL.revokeObjectURL(url.current);
    },
    [],
  );
  const prepare = useCallback((contents: string, type: string, filename: string) => {
    if (url.current !== null) URL.revokeObjectURL(url.current);
    const href = URL.createObjectURL(new Blob([contents], { type }));
    url.current = href;
    setPrepared({ href, filename });
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
    }
  }, []);
  return { prepared, prepare };
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
    onRecords(environmentId, { records, error: query.error, isPending: query.isPending });
  }, [environmentId, onRecords, records, query.error, query.isPending]);
  return null;
}

export function RaceScoreboard({
  environments,
  liveRaceKeys,
  promptKey = null,
}: {
  environments: ReadonlyArray<EnvironmentRef>;
  /** Show every run of this prompt instead of the ladder. */
  promptKey?: string | null;
  /** `${environmentId}\0${raceId}` of races whose entrants still exist. */
  liveRaceKeys: ReadonlySet<string>;
}) {
  const exportDownload = usePreparedRaceDownload();
  const [byEnvironment, setByEnvironment] = useState<ReadonlyMap<string, EnvironmentHistoryState>>(
    () => new Map(),
  );
  const onRecords = useCallback((environmentId: EnvironmentId, state: EnvironmentHistoryState) => {
    setByEnvironment((current) => {
      const previous = current.get(environmentId);
      if (
        previous &&
        previous.records === state.records &&
        previous.error === state.error &&
        previous.isPending === state.isPending
      ) {
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
      return (
        state === undefined || state.isPending || (state.records === null && state.error === null)
      );
    });
  const errors = connected.flatMap((environment) => {
    const error = byEnvironment.get(environment.environmentId)?.error;
    return error ? [{ label: environment.label, error }] : [];
  });

  const [pair, setPair] = useState<RaceMatchup | null>(null);
  const [kind, setKind] = useState<RaceTaskKind | null>(null);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [outcome, setOutcome] = useState<RaceHistoryOutcome | "">("");
  const [after, setAfter] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const projects = useMemo(
    () =>
      [
        ...new Map(
          records.map((record) => [
            `${record.environmentId}\0${record.projectId}`,
            {
              value: `${record.environmentId}\0${record.projectId}`,
              label: `${record.projectTitle || record.projectId} · ${environments.find((item) => item.environmentId === record.environmentId)?.label ?? record.environmentId}`,
            },
          ]),
        ).values(),
      ].toSorted((left, right) => left.label.localeCompare(right.label)),
    [records, environments],
  );
  const scoped = useMemo(() => {
    const source = project
      ? records.filter((record) => `${record.environmentId}\0${record.projectId}` === project)
      : records;
    // Query each computer separately so one computer's 500-record cap does not
    // truncate another computer's history after combining the responses.
    return connected
      .flatMap(
        (environment) =>
          queryRaceHistory(
            source.filter((record) => record.environmentId === environment.environmentId),
            {
              query,
              ...(outcome ? { outcome } : {}),
              ...(after ? { after } : {}),
            },
          ).records,
      )
      .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
  }, [records, project, connected, query, outcome, after]);
  const pairedScope = useMemo(
    () => (pair ? scoped.filter((record) => raceContainsPair(record, pair)) : scoped),
    [scoped, pair],
  );
  const kindsPresent = (Object.keys(RACE_TASK_KIND_LABELS) as RaceTaskKind[]).filter((item) =>
    pairedScope.some((record) => record.taskKind === item),
  );
  const allPairsScope = useMemo(
    () => (kind ? scoped.filter((record) => record.taskKind === kind) : scoped),
    [kind, scoped],
  );
  const filtered = useMemo(
    () => (kind ? pairedScope.filter((record) => record.taskKind === kind) : pairedScope),
    [kind, pairedScope],
  );
  const matchups = useMemo(() => buildRaceMatchups(allPairsScope), [allPairsScope]);
  const board = useMemo(() => buildRaceLeaderboard(filtered), [filtered]);
  const leaders = useMemo(() => buildRaceKindLeaders(pairedScope), [pairedScope]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const exportHistory = (format: "json" | "csv" | "md") => {
    const capturedAt = new Date().toISOString();
    const capturedRecords = filtered.map((record) => ({
      ...record,
      environmentLabel:
        environments.find((item) => item.environmentId === record.environmentId)?.label ??
        record.environmentId,
    }));
    const contents =
      format === "md"
        ? raceEvidenceMarkdown(capturedRecords, capturedAt)
        : format === "csv"
          ? raceHistoryCsv(capturedRecords)
          : JSON.stringify(
              {
                version: 1,
                capturedAt,
                filters: {
                  query,
                  project,
                  outcome,
                  after,
                  kind,
                  pair: pair ? { left: pair.left, right: pair.right } : null,
                },
                scope:
                  "Retained history from connected computers; at most 500 races per computer. Missing costs are unknown.",
                environments: environments.map((environment) => ({
                  ...environment,
                  loaded: byEnvironment.get(environment.environmentId)?.records?.length ?? 0,
                })),
                records: capturedRecords,
                leaderboard: board,
                matchups: buildRaceMatchups(capturedRecords),
              },
              null,
              2,
            );
    exportDownload.prepare(
      contents,
      format === "md"
        ? "text/markdown;charset=utf-8"
        : format === "csv"
          ? "text/csv;charset=utf-8"
          : "application/json",
      `t3-races-${capturedAt.slice(0, 10)}.${format}`,
    );
  };
  const promptRunCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of records) {
      const key = racePromptKey(record.prompt);
      counts.set(key, (counts.get(key) ?? 0) + raceHeats(record).length);
    }
    return counts;
  }, [records]);
  const ladder = useMemo(() => buildRaceLadder(records, { taskKind: kind }), [records, kind]);
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

      <section
        aria-label="Filter race history"
        className="flex min-w-0 flex-col gap-3 border-b border-border pb-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground"
            />
            <Input
              aria-label="Search retained races"
              placeholder="Search prompts, models, projects or failures…"
              className="h-9 pl-8 text-xs"
              value={query}
              maxLength={300}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="w-60 max-w-full">
            <RaceSelect
              ariaLabel="Filter by project and computer"
              value={project}
              options={[
                { value: "", label: "All projects and computers" },
                ...projects,
                ...(project && !projects.some((item) => item.value === project)
                  ? [{ value: project, label: "Project unavailable" }]
                  : []),
              ]}
              onChange={(value) => {
                setProject(value);
                setPage(0);
              }}
            />
          </div>
          <div className="w-40">
            <RaceSelect
              ariaLabel="Filter race outcome"
              value={outcome}
              options={[
                { value: "", label: "All outcomes" },
                { value: "kept", label: "Kept a winner" },
                { value: "none", label: "No winner" },
                { value: "open", label: "Undecided" },
              ]}
              onChange={(value) => {
                if (value === "" || value === "kept" || value === "none" || value === "open")
                  setOutcome(value);
                setPage(0);
              }}
            />
          </div>
          <div className="w-36">
            <RaceSelect
              ariaLabel="Filter race age"
              value={after ? "recent" : ""}
              options={[
                { value: "", label: "All retained time" },
                { value: "recent", label: "Last 30 days" },
              ]}
              onChange={(value) => {
                setAfter(value ? new Date(Date.now() - 30 * 86_400_000).toISOString() : "");
                setPage(0);
              }}
            />
          </div>
        </div>
        {pair ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>
              Shared races: {pair.left.label} versus {pair.right.label}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPair(null);
                setPage(0);
              }}
            >
              Clear model pair
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <p role="status">
            {filtered.length} matching of {records.length} loaded races · connected computers only ·
            up to 500 retained per computer
            {environments.some((environment) => !environment.connected)
              ? " · offline computers excluded"
              : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={loading || connected.length === 0}
              onClick={() => {
                for (const environment of connected) {
                  appAtomRegistry.refresh(
                    raceHistoryEnvironment.list({
                      environmentId: environment.environmentId,
                      input: {},
                    }),
                  );
                }
              }}
            >
              <RefreshCwIcon className="size-3.5" />
              {loading ? "Refreshing…" : "Refresh history"}
            </Button>
            {query || project || outcome || after || kind ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPair(null);
                  setQuery("");
                  setProject("");
                  setOutcome("");
                  setAfter("");
                  setKind(null);
                  setPage(0);
                }}
              >
                Clear filters
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={loading || errors.length > 0 || filtered.length === 0}
              onClick={() => exportHistory("json")}
            >
              <DownloadIcon className="size-3.5" />
              JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || errors.length > 0 || filtered.length === 0}
              onClick={() => exportHistory("csv")}
            >
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || errors.length > 0 || filtered.length === 0}
              onClick={() => exportHistory("md")}
            >
              Markdown
            </Button>
            {exportDownload.prepared ? (
              <a
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                href={exportDownload.prepared.href}
                download={exportDownload.prepared.filename}
              >
                Save prepared export
              </a>
            ) : null}
          </div>
        </div>
      </section>

      {promptKey ? (
        <PromptHistory records={records} promptKey={promptKey} loading={loading} />
      ) : records.length === 0 ? (
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
                : errors.length > 0
                  ? "Could not read race history"
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
                count={pairedScope.length}
                onClick={() => {
                  setKind(null);
                  setPage(0);
                }}
              />
              {kindsPresent.map((item) => (
                <KindChip
                  key={item}
                  label={RACE_TASK_KIND_LABELS[item]}
                  active={kind === item}
                  count={pairedScope.filter((record) => record.taskKind === item).length}
                  onClick={() => {
                    setKind(kind === item ? null : item);
                    setPage(0);
                  }}
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
                    onClick={() => {
                      setKind(item.taskKind);
                      setPage(0);
                    }}
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
                Ladder{kind ? ` · ${RACE_TASK_KIND_LABELS[kind]}` : ""}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Ratings move with every judged or kept head-to-head; ± shrinks as they add up. Cost
                is what the provider reported.
              </p>
            </div>
            <LadderTable ladder={ladder} board={board} />
          </section>

          <RaceMatchups
            rows={matchups}
            selectedKey={pair?.key ?? null}
            onSelect={(row) => {
              setPair(row);
              setPage(0);
            }}
          />

          <section aria-label="Race history" className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium">
              History
              <span className="ml-1.5 text-muted-foreground tabular-nums">{filtered.length}</span>
            </h3>
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No races match these filters. Clear filters to see all loaded history.
              </p>
            ) : null}
            <ol className="flex min-w-0 flex-col divide-y divide-border/60 overflow-hidden border-y border-border/70">
              {visible.map((record) => (
                <HistoryRow
                  key={`${record.environmentId}\0${record.raceId}`}
                  record={record}
                  connected={environments.some(
                    (environment) =>
                      environment.environmentId === record.environmentId && environment.connected,
                  )}
                  live={liveRaceKeys.has(`${record.environmentId}\0${record.raceId}`)}
                  promptRuns={promptRunCounts.get(racePromptKey(record.prompt)) ?? 1}
                />
              ))}
            </ol>
            {filtered.length > pageSize ? (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {currentPage * pageSize + 1}–
                  {Math.min((currentPage + 1) * pageSize, filtered.length)} of {filtered.length} ·
                  exports include every match
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={(currentPage + 1) * pageSize >= filtered.length}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
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

/**
 * The ladder: Elo-style ratings from judged and kept head-to-heads, joined
 * with each agent's keep rate, time and reported cost.
 */
function LadderTable({
  ladder,
  board,
}: {
  ladder: ReadonlyArray<RaceLadderRow>;
  board: ReadonlyArray<RaceLeaderboardRow>;
}) {
  const boardByKey = new Map(board.map((row) => [row.key, row] as const));
  // Agents that raced but never met a decided head-to-head sit below the rated ones.
  const unrated = board.filter((row) => !ladder.some((item) => item.key === row.key));
  if (ladder.length === 0 && unrated.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
        No races of this kind yet.
      </p>
    );
  }
  const maxRating = Math.max(...ladder.map((row) => row.rating), RACE_LADDER_START_RATING + 1);
  const minRating = Math.min(...ladder.map((row) => row.rating), RACE_LADDER_START_RATING - 1);
  return (
    <div className="min-w-0 overflow-x-auto rounded-2xl border border-border/70 bg-card/60">
      <table className="w-full min-w-[48rem] text-xs">
        <thead>
          <tr className="border-b border-border/70 bg-muted/30 text-left text-[11px] text-muted-foreground">
            <th className="w-8 px-3.5 py-2 font-medium">#</th>
            <th className="px-2 py-2 font-medium">Agent</th>
            <th className="w-44 px-2 py-2 font-medium">Rating</th>
            <th className="px-2 py-2 text-right font-medium">W–L</th>
            <th className="px-2 py-2 text-right font-medium">Keep rate</th>
            <th className="px-2 py-2 text-right font-medium">Median time</th>
            <th className="px-2 py-2 text-right font-medium">Median cost</th>
            <th className="px-3.5 py-2 text-right font-medium">Failed</th>
          </tr>
        </thead>
        <tbody>
          {ladder.map((row, index) => {
            const stats = boardByKey.get(row.key);
            const position = (row.rating - minRating) / Math.max(1, maxRating - minRating);
            return (
              <tr key={row.key} className="border-b border-border/50 last:border-b-0">
                <td className="px-3.5 py-2.5 text-muted-foreground tabular-nums">
                  {index === 0 && row.wins > 0 ? (
                    <CrownIcon
                      className="size-3.5 text-amber-500 dark:text-amber-300"
                      aria-label="Top rated"
                    />
                  ) : (
                    index + 1
                  )}
                </td>
                <td className="px-2 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <AgentIcon driver={row.driver} className="shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{row.label}</span>
                    {row.provisional ? (
                      <Hint
                        text={`Fewer than ${RACE_LADDER_PROVISIONAL_GAMES} head-to-heads: this rating can still swing a lot`}
                      >
                        <Badge size="sm" variant="secondary">
                          provisional
                        </Badge>
                      </Hint>
                    ) : null}
                  </span>
                </td>
                <td className="px-2 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="w-16 font-semibold tabular-nums">
                      {row.rating}
                      <span className="ml-1 font-normal text-muted-foreground">±{row.spread}</span>
                    </span>
                    <span aria-hidden className="relative h-1.5 w-20 rounded-full bg-muted">
                      <span
                        className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500 ring-2 ring-background dark:bg-amber-300"
                        style={{ left: `${Math.round(position * 100)}%` }}
                      />
                    </span>
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  <Hint text={`${row.games} head-to-heads`}>
                    <span>
                      <span className="text-success">{row.wins}</span>–
                      <span className="text-destructive">{row.losses}</span>
                    </span>
                  </Hint>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {stats ? (
                    <Hint text={`${stats.wins} of ${stats.decided} decided`}>
                      {percent(stats.keepRate)}
                    </Hint>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {formatRaceDuration(stats?.medianMs ?? null)}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  <Hint
                    text={
                      !stats || stats.costReports === 0
                        ? "This provider reported no cost"
                        : `From ${stats.costReports} of ${stats.races} runs`
                    }
                  >
                    {formatRaceCost(stats?.medianCostUsd ?? null)}
                  </Hint>
                </td>
                <td
                  className={cn(
                    "px-3.5 py-2.5 text-right tabular-nums",
                    (stats?.failures ?? 0) > 0 && "text-destructive",
                  )}
                >
                  {stats?.failures ?? 0}
                </td>
              </tr>
            );
          })}
          {unrated.map((row) => (
            <tr
              key={row.key}
              className="border-b border-border/50 text-muted-foreground last:border-b-0"
            >
              <td className="px-3.5 py-2.5">—</td>
              <td className="px-2 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <AgentIcon driver={row.driver} className="shrink-0" />
                  <span className="truncate">{row.label}</span>
                </span>
              </td>
              <td className="px-2 py-2.5 text-[11px]">unrated: no decided head-to-head yet</td>
              <td className="px-2 py-2.5 text-right">—</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{percent(row.keepRate)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">
                {formatRaceDuration(row.medianMs)}
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums">
                {formatRaceCost(row.medianCostUsd)}
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

function HistoryRow({
  record,
  live,
  connected,
  promptRuns,
}: {
  record: ScoreboardRecord;
  live: boolean;
  connected: boolean;
  /** Heats of every race on this record's prompt. */
  promptRuns: number;
}) {
  const evidenceDownload = usePreparedRaceDownload();
  const navigate = useNavigate();
  const snapshot = useAtomValue(environmentSnapshotAtom(record.environmentId));
  const availableThreads = useMemo(
    () => new Set((connected ? (snapshot?.threads ?? []) : []).map((thread) => thread.id)),
    [snapshot?.threads, connected],
  );
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
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() => {
          const contents = raceEvidenceMarkdown([record], new Date().toISOString());
          evidenceDownload.prepare(
            contents,
            "text/markdown;charset=utf-8",
            `t3-race-${new Date().toISOString().slice(0, 10)}.md`,
          );
        }}
      >
        <DownloadIcon className="size-3.5" /> Race evidence
      </Button>
      {evidenceDownload.prepared ? (
        <a
          className="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          href={evidenceDownload.prepared.href}
          download={evidenceDownload.prepared.filename}
        >
          Save prepared evidence
        </a>
      ) : null}
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
              {entrant.threadId && availableThreads.has(entrant.threadId) ? (
                <button
                  type="button"
                  className="truncate font-medium underline-offset-4 hover:underline focus-visible:underline"
                  aria-label={`Open ${entrant.label} conversation`}
                  onClick={() =>
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: { environmentId: record.environmentId, threadId: entrant.threadId! },
                    })
                  }
                >
                  {entrant.label} ↗
                </button>
              ) : (
                <Hint
                  text={
                    entrant.threadId
                      ? "Conversation is unavailable or this computer is offline"
                      : "Conversation link was not recorded"
                  }
                >
                  <span className="truncate font-medium">{entrant.label}</span>
                </Hint>
              )}
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
      {(record.rematches ?? []).map((heat) => (
        <p
          key={heat.heat}
          className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          <SwordsIcon className="size-3" />
          Rematch {heat.heat - 1}:{" "}
          {heat.outcome === "kept"
            ? `kept #${heat.keptSlot} ${record.entrants.find((entrant) => entrant.slot === heat.keptSlot)?.label ?? ""}`
            : heat.outcome === "none"
              ? "no winner"
              : heat.judge?.pickSlot
                ? `judge picked #${heat.judge.pickSlot}`
                : "undecided"}{" "}
          · {heat.participants.length} in the arena
        </p>
      ))}
      <button
        type="button"
        onClick={() =>
          void navigate({
            to: "/race",
            search: { view: "scoreboard", prompt: racePromptKey(record.prompt) },
          })
        }
        className="self-start text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        {promptRuns > 1 ? `All ${promptRuns} runs of this prompt →` : "This prompt's runs →"}
      </button>
      {record.judge ? (
        <p className="text-[11px] text-muted-foreground">
          Judged by{" "}
          {record.judge.threadId && availableThreads.has(record.judge.threadId) ? (
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() =>
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: {
                    environmentId: record.environmentId,
                    threadId: record.judge!.threadId!,
                  },
                })
              }
            >
              {record.judge.label} ↗
            </button>
          ) : (
            record.judge.label
          )}
          :{" "}
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

/**
 * Every run of one prompt, original races and rematches alike, newest first,
 * with each agent's record on it: the view that shows a prompt getting
 * re-raced as models change.
 */
function PromptHistory({
  records,
  promptKey,
  loading,
}: {
  records: ReadonlyArray<ScoreboardRecord>;
  promptKey: string;
  loading: boolean;
}) {
  const navigate = useNavigate();
  const runs = useMemo(() => buildRacePromptRuns(records, promptKey), [records, promptKey]);
  const prompt = runs[0]?.record.prompt ?? null;
  const agents = useMemo(() => {
    const byKey = new Map<
      string,
      { label: string; driver: string; runs: number; wins: number; best: number | null }
    >();
    for (const run of runs) {
      for (const entrant of run.entrants) {
        const key = raceAgentKey(entrant);
        const row = byKey.get(key) ?? {
          label: entrant.label,
          driver: entrant.driver,
          runs: 0,
          wins: 0,
          best: null,
        };
        row.runs += 1;
        if (run.winnerSlot === entrant.slot) row.wins += 1;
        if (entrant.phase === "finished" && entrant.elapsedMs !== null) {
          row.best = row.best === null ? entrant.elapsedMs : Math.min(row.best, entrant.elapsedMs);
        }
        byKey.set(key, row);
      }
    }
    return [...byKey.values()].toSorted(
      (left, right) => right.wins - left.wins || right.runs - left.runs,
    );
  }, [runs]);

  return (
    <section aria-label="Runs of this prompt" className="flex min-w-0 flex-col gap-4">
      <button
        type="button"
        onClick={() => void navigate({ to: "/race", search: { view: "scoreboard" } })}
        className="self-start text-xs text-muted-foreground hover:text-foreground"
      >
        ← Ladder
      </button>
      {runs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {loading ? "Reading race history…" : "No recorded race used this prompt."}
        </p>
      ) : (
        <>
          <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-border/70 bg-card/60 px-4 py-3">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Prompt · {runs.length} {runs.length === 1 ? "run" : "runs"}
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{prompt}</p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            {agents.map((agent) => (
              <span
                key={agent.label}
                className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-xs"
              >
                <AgentIcon driver={agent.driver} className="size-3.5" />
                <span className="font-medium">{agent.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {agent.wins}/{agent.runs} won
                  {agent.best !== null ? ` · best ${formatRaceDuration(agent.best)}` : ""}
                </span>
              </span>
            ))}
          </div>
          <ol className="relative flex min-w-0 flex-col gap-3 border-l border-border/70 pl-4">
            {runs.map((run) => (
              <li
                key={`${run.record.environmentId}:${run.record.raceId}:${run.heat.heat}`}
                className="relative min-w-0"
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-4 ring-background",
                    run.winnerSlot !== null
                      ? "bg-amber-500 dark:bg-amber-300"
                      : "bg-muted-foreground/40",
                  )}
                />
                <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card/60 px-3.5 py-3">
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
                    <span className="font-medium">
                      {run.heat.heat === 1 ? "Original race" : `Rematch ${run.heat.heat - 1}`}
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {formatRelativeTimeLabel(run.heat.startedAt)} · {run.record.projectTitle}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      {run.heat.outcome === "kept"
                        ? "kept"
                        : run.heat.outcome === "none"
                          ? "no winner"
                          : run.winnerSlot !== null
                            ? "judged"
                            : "undecided"}
                    </span>
                  </div>
                  <ul className="flex min-w-0 flex-wrap gap-1.5">
                    {run.entrants.map((entrant) => (
                      <li
                        key={entrant.slot}
                        className={cn(
                          "flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1 text-[11px]",
                          run.winnerSlot === entrant.slot
                            ? "border-amber-500/40 bg-amber-500/8"
                            : entrant.phase === "failed"
                              ? "border-destructive/30 bg-destructive/5"
                              : "border-border/70 bg-background/50",
                        )}
                      >
                        <AgentIcon driver={entrant.driver} className="size-3.5 shrink-0" />
                        <span className="truncate font-medium">{entrant.label}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {entrant.phase === "failed"
                            ? "failed"
                            : `${formatRaceDuration(entrant.elapsedMs)}${entrant.costUsd !== null ? ` · ${formatRaceCost(entrant.costUsd)}` : ""}`}
                        </span>
                        {run.winnerSlot === entrant.slot ? (
                          <CrownIcon
                            className="size-3 text-amber-600 dark:text-amber-300"
                            aria-label="Winner"
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
