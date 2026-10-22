/* agent-watermark: model=opus-5.5; effort=high; duration=25m; seat=claude-code; date=2026-10-22 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, RaceAutopilot, RaceAutopilotStage } from "@t3tools/contracts";
import {
  buildRaceJudgeTitle,
  parseRaceJudgeHeat,
  parseRaceJudgeMarker,
  parseRaceJudgeVerdict,
} from "@t3tools/shared/race";
import { isRaceAutopilotActive } from "@t3tools/shared/raceHistory";
import { useNavigate } from "@tanstack/react-router";
import { memo, useEffect, useEffectEvent, useMemo, useRef } from "react";

import { useThread, useThreadShells, waitForThreadShell } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { raceHistoryEnvironment } from "../../state/raceHistory";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { showAgentNotice } from "../notifications/AgentNotifications";
import { toastManager } from "../ui/toast";
import {
  groupRaces,
  raceEntrantPhase,
  raceProviders,
  type RaceEntrant,
  type RaceGroup,
} from "./race.logic";
import { raceJudgePhase } from "./raceArena.logic";
import { nextRaceAutopilotStep } from "./raceAutopilot.logic";
import { buildRaceJudgeTurn, raceJudgeAnswer } from "./raceJudgeRun";
import { formatRaceAgentLabel } from "./raceLabels";
import { useEntrantReport, useEntrantReports, type EntrantReport } from "./useEntrantReport";
import { useRaceBase } from "./useRaceBase";
import { useRaceBoardContext } from "./useRaceBoardContext";
import {
  raceEntrantLabel,
  useRaceEntrantActions,
  type RaceBoardContext,
} from "./useRaceEntrantActions";
import { useRaceHistoryRecord } from "./useRaceHistoryRecord";
import { useRaceRecorder } from "./useRaceRecorder";

type Race = RaceGroup<EnvironmentThreadShell>;
const AUTOPILOT_REFRESH_MS = 30_000;
type Entrant = RaceEntrant<EnvironmentThreadShell>;

/**
 * Carries out races on autopilot from any open client: once every entrant has
 * stopped it asks the planned judge, and when the judge names a winner it keeps
 * it (if the race said to), records the result and says what happened. Each
 * step is claimed on the server first, so with several clients open only one
 * acts. Mounted once in the app layout; renders nothing visible.
 */
export function RaceAutopilotHost() {
  const { environments } = useEnvironments();
  const connected = environments.filter(
    (environment) => environment.connection.phase === "connected",
  );
  return (
    <>
      {connected.map((environment) => (
        <EnvironmentAutopilots
          key={environment.environmentId}
          environmentId={environment.environmentId}
        />
      ))}
    </>
  );
}

function EnvironmentAutopilots({ environmentId }: { environmentId: EnvironmentId }) {
  const history = useEnvironmentQuery(
    raceHistoryEnvironment.list({ environmentId, input: { limit: 1 } }),
  );
  // Another device may arm a race (a phone starts it, then closes): look again
  // now and then so this client can carry it out.
  const refresh = history.refresh;
  useEffect(() => {
    const handle = window.setInterval(refresh, AUTOPILOT_REFRESH_MS);
    return () => window.clearInterval(handle);
  }, [refresh]);
  const active = useMemo(
    () => (history.data?.autopilots ?? []).filter((item) => isRaceAutopilotActive(item.stage)),
    [history.data],
  );
  if (active.length === 0) return null;
  return <ActiveAutopilots environmentId={environmentId} autopilots={active} />;
}

function ActiveAutopilots({
  environmentId,
  autopilots,
}: {
  environmentId: EnvironmentId;
  autopilots: ReadonlyArray<RaceAutopilot>;
}) {
  const threads = useThreadShells();
  const context = useRaceBoardContext();
  const races = useMemo(
    () => groupRaces(threads.filter((thread) => thread.environmentId === environmentId)),
    [threads, environmentId],
  );
  return (
    <>
      {autopilots.map((autopilot) => {
        const race = races.find((item) => item.raceId === autopilot.raceId);
        return race ? (
          <AutopilotRunner
            key={autopilot.raceId}
            race={race}
            autopilot={autopilot}
            context={context}
          />
        ) : null;
      })}
    </>
  );
}

/** Reads one entrant's diff and transcript, as an arena lane does, without drawing it. */
const EntrantReporter = memo(function EntrantReporter({
  shell,
  baseRef,
  onReport,
}: {
  shell: EnvironmentThreadShell;
  baseRef: string | null;
  onReport: (threadId: string, report: EntrantReport) => void;
}) {
  const { report } = useEntrantReport(shell, baseRef);
  useEffect(() => {
    onReport(shell.id, report);
  }, [onReport, shell.id, report]);
  return null;
});

/** This heat's judge, read the way the arena reads it: newest judge thread whose brief names this race and heat. */
function useHeatJudge(race: Race, heat: number) {
  const threads = useThreadShells();
  const judgeTitle = buildRaceJudgeTitle(race.titleSeed);
  const newest = useMemo(
    () =>
      threads
        .filter(
          (thread) =>
            thread.environmentId === race.environmentId &&
            thread.projectId === race.projectId &&
            thread.archivedAt === null &&
            thread.title === judgeTitle,
        )
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null,
    [threads, race.environmentId, race.projectId, judgeTitle],
  );
  const thread = useThread(newest ? scopeThreadRef(newest.environmentId, newest.id) : null);
  if (!newest || !thread) return null;
  const brief = thread.messages.find((message) => message.role === "user")?.text;
  if (parseRaceJudgeMarker(brief) !== race.raceId || parseRaceJudgeHeat(brief) !== heat) {
    return null;
  }
  return { shell: newest, thread };
}

function AutopilotRunner({
  race,
  autopilot,
  context,
}: {
  race: Race;
  autopilot: RaceAutopilot;
  context: RaceBoardContext;
}) {
  const navigate = useNavigate();
  const [reports, report] = useEntrantReports();
  const base = useRaceBase(race);
  const actions = useRaceEntrantActions(race, context);
  const recordResult = useRaceRecorder(race, context, reports, {
    heat: autopilot.heat,
    baseCommit: base.commit,
  });
  const advance = useAtomCommand(raceHistoryEnvironment.advanceAutopilot, {
    reportFailure: false,
  });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });

  const judgeProvider =
    context.providersByKey.get(`${race.environmentId}\0${autopilot.judge.instanceId}`) ?? null;
  const judgeLabel = formatRaceAgentLabel(judgeProvider, autopilot.judge);
  const judgeReady =
    judgeProvider !== null &&
    raceProviders([judgeProvider]).length === 1 &&
    judgeProvider.models.some((model) => model.slug === autopilot.judge.model);

  const heatJudge = useHeatJudge(race, autopilot.heat);
  const entrantSlots = useMemo(() => race.entrants.map((entrant) => entrant.slot), [race.entrants]);
  const judgeAnswer = heatJudge ? raceJudgeAnswer(heatJudge.thread) : null;
  const judgeVerdict = useMemo(
    () => parseRaceJudgeVerdict(judgeAnswer, entrantSlots),
    [judgeAnswer, entrantSlots],
  );
  const judgeView = heatJudge
    ? {
        phase: raceJudgePhase(heatJudge.shell),
        verdict: judgeVerdict,
        error: heatJudge.thread.session?.lastError ?? null,
      }
    : null;

  const { currentHeatView } = useRaceHistoryRecord(race);
  const step = nextRaceAutopilotStep({
    stage: autopilot.stage,
    keep: autopilot.keep,
    decided:
      currentHeatView !== null &&
      currentHeatView.heat === autopilot.heat &&
      currentHeatView.outcome !== "open",
    entrants: race.entrants.map((entrant) => {
      const phase = raceEntrantPhase(entrant.thread);
      const changes = reports.get(entrant.thread.id)?.changes ?? null;
      return {
        slot: entrant.slot,
        phase,
        // An entrant that failed before its worktree existed has no diff to read.
        loaded: changes !== null || (phase === "failed" && entrant.thread.worktreePath === null),
        files: changes?.files.length ?? 0,
      };
    }),
    judge: judgeView,
    judgeReady,
    judgeLabel,
  });
  const stepKey = JSON.stringify(step);

  const busy = useRef(false);

  // Takes a step at most once; false when there is nothing to do or a step is still running.
  const act = useEffectEvent(() => {
    const current = step;
    if (current.kind === "wait" || busy.current) return false;
    busy.current = true;

    const claim = async (from: RaceAutopilotStage, to: RaceAutopilotStage, note: string) => {
      const result = await advance({
        environmentId: race.environmentId,
        input: { raceId: race.raceId, from, to, note },
      });
      return result._tag === "Success" && result.value.applied;
    };
    const announce = (note: string, tone: "success" | "warning") => {
      const title = `Race: ${race.titleSeed}`;
      toastManager.add({
        type: tone,
        title,
        description: note,
        actionProps: {
          children: "Open arena",
          onClick: () => void navigate({ to: "/race", search: { race: race.raceId } }),
        },
      });
      const notice = showAgentNotice(title, note);
      notice?.addEventListener("click", () => {
        window.focus();
        void navigate({ to: "/race", search: { race: race.raceId } });
        notice.close();
      });
    };
    const judgeOfRecord = () => {
      const judge = heatJudge;
      if (!judge) return null;
      const verdict = judgeVerdict;
      return {
        instanceId: judge.shell.modelSelection.instanceId,
        driver:
          context.providersByKey.get(
            `${race.environmentId}\0${judge.shell.modelSelection.instanceId}`,
          )?.driver ?? judge.shell.modelSelection.instanceId,
        model: judge.shell.modelSelection.model,
        label: formatRaceAgentLabel(
          context.providersByKey.get(
            `${race.environmentId}\0${judge.shell.modelSelection.instanceId}`,
          ) ?? null,
          judge.shell.modelSelection,
        ),
        pickSlot: verdict?.kind === "winner" ? verdict.slot : null,
      };
    };

    const run = async () => {
      switch (current.kind) {
        case "adopt-judge": {
          await claim("waiting", "judging", current.note);
          return;
        }
        case "start-judge": {
          if (!judgeProvider || !(await claim("waiting", "judging", current.note))) return;
          const turn = buildRaceJudgeTurn({
            race: race,
            context,
            reports: reports,
            heat: autopilot.heat,
            checkoutBranch: actions.checkoutBranch,
            modelSelection: { instanceId: judgeProvider.instanceId, model: autopilot.judge.model },
          });
          const result = await startTurn(turn.command);
          if (result._tag === "Failure") {
            const error = isAtomCommandInterrupted(result)
              ? null
              : squashAtomCommandFailure(result);
            const note = `The judge could not start${error instanceof Error ? `: ${error.message}` : "."}`;
            await claim("judging", "stopped", note);
            announce(note, "warning");
            return;
          }
          await waitForThreadShell(scopeThreadRef(race.environmentId, turn.threadId)).catch(
            () => null,
          );
          return;
        }
        case "keep": {
          const entrant = race.entrants.find((item: Entrant) => item.slot === current.slot);
          if (!entrant) return;
          const label = raceEntrantLabel(race, entrant, context);
          if (!(await claim("judging", "keeping", `Keeping Entrant ${current.slot} (${label}).`))) {
            return;
          }
          // Snapshot before Keep discards the losers, so their lines are recorded too.
          const entrants = race.entrants;
          const judge = judgeOfRecord();
          let refusal: string | null = null;
          const kept = await actions.keep(entrant, {
            confirm: false,
            onRefused: (reason) => {
              refusal = reason;
            },
          });
          if (kept) {
            await recordResult({ outcome: "kept", keptSlot: current.slot, judge }, entrants);
            const note = `Kept Entrant ${current.slot} (${label}) in ${actions.checkoutBranch ?? "the project checkout"}; the others were discarded.`;
            await claim("keeping", "done", note);
            announce(note, "success");
          } else {
            await recordResult({ outcome: "open", judge }, entrants);
            const note = `The judge picked Entrant ${current.slot} (${label}), but it was not kept${refusal ? `: ${refusal}` : "."} Keep it from the arena.`;
            await claim("keeping", "stopped", note);
            announce(note, "warning");
          }
          return;
        }
        case "end": {
          const judge = judgeOfRecord();
          if (judge) await recordResult({ outcome: "open", judge });
          if (await claim(current.from, current.to, current.note)) {
            announce(current.note, current.to === "done" ? "success" : "warning");
          }
          return;
        }
      }
    };
    void run().finally(() => {
      busy.current = false;
    });
    return true;
  });
  // Act when the step changes, not on every render that reaches the same step.
  const actedOn = useRef<string | null>(null);
  useEffect(() => {
    if (actedOn.current === stepKey) return;
    if (act()) actedOn.current = stepKey;
  });

  return (
    <>
      {race.entrants.map((entrant) => (
        <EntrantReporter
          key={entrant.thread.id}
          shell={entrant.thread}
          baseRef={base.commit}
          onReport={report}
        />
      ))}
    </>
  );
}
