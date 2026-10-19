/* agent-watermark: model=opus-5.5; effort=high; duration=14m; seat=claude-code; date=2026-10-19 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { RaceHistoryJudge, RaceHistoryOutcome, RaceTaskKind } from "@t3tools/contracts";
import { useCallback } from "react";

import { raceHistoryEnvironment } from "../../state/raceHistory";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { raceEntrantElapsedMs } from "./raceArena.logic";
import { raceSelectionEffort } from "./raceLabels";
import { buildRaceRecordInput } from "./raceRecord.logic";
import { raceEntrantPhase, type RaceEntrant, type RaceGroup } from "./race.logic";
import type { EntrantReport } from "./useEntrantReport";
import {
  raceEntrantLabel,
  raceEntrantProvider,
  type RaceBoardContext,
} from "./useRaceEntrantActions";

type Race = RaceGroup<EnvironmentThreadShell>;

export interface RaceRecordRequest {
  readonly outcome: RaceHistoryOutcome;
  readonly keptSlot?: number | null;
  readonly judge?: RaceHistoryJudge | null;
  readonly taskKind?: RaceTaskKind | null;
  /** The heat this decides; the race's current heat when absent. */
  readonly heat?: number;
}

/**
 * Sends a race's result to the server's race history. Called when a judge
 * answers, when an entrant is kept, when the user closes a race without a
 * winner, and when they correct its kind of task.
 */
export function useRaceRecorder(
  race: Race,
  context: RaceBoardContext,
  reports: ReadonlyMap<string, EntrantReport>,
  options: { readonly heat?: number; readonly baseCommit?: string | null } = {},
) {
  const currentHeat = options.heat ?? 1;
  const baseCommit = options.baseCommit ?? null;
  const record = useAtomCommand(raceHistoryEnvironment.record, { reportFailure: false });
  const project = context.projectsByKey.get(`${race.environmentId}\0${race.projectId}`) ?? null;

  return useCallback(
    async (
      request: RaceRecordRequest,
      entrants: ReadonlyArray<RaceEntrant<EnvironmentThreadShell>> = race.entrants,
    ): Promise<boolean> => {
      const now = Date.now();
      const prompt =
        entrants
          .map((entrant) => reports.get(entrant.thread.id)?.prompt)
          .find((text): text is string => typeof text === "string" && text.trim().length > 0) ??
        race.titleSeed;
      const input = buildRaceRecordInput({
        raceId: race.raceId,
        projectId: race.projectId,
        projectTitle: project?.title ?? "",
        titleSeed: race.titleSeed,
        prompt,
        startedAt: race.startedAt,
        outcome: request.outcome,
        keptSlot: request.keptSlot ?? null,
        judge: request.judge ?? null,
        taskKind: request.taskKind ?? null,
        heat: request.heat ?? currentHeat,
        // Whoever is in the arena now is in this heat, a defending champion included.
        participants: entrants.map((entrant) => entrant.slot),
        baseCommit,
        entrants: entrants.map((entrant) => {
          const provider = raceEntrantProvider(race, entrant, context);
          const report = reports.get(entrant.thread.id);
          return {
            slot: entrant.slot,
            instanceId: entrant.thread.modelSelection.instanceId,
            driver: provider?.driver ?? entrant.thread.modelSelection.instanceId,
            model: entrant.thread.modelSelection.model,
            effort: raceSelectionEffort(provider, entrant.thread.modelSelection),
            label: raceEntrantLabel(race, entrant, context),
            phase: raceEntrantPhase(entrant.thread),
            elapsedMs: raceEntrantElapsedMs(entrant.thread.latestTurn, now),
            changes: report?.changes ?? null,
            costUsd: report?.costUsd ?? null,
            failure: report?.failure ?? null,
          };
        }),
      });
      const result = await record({ environmentId: race.environmentId, input });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "warning",
            title: "The race result was not recorded",
            description: error instanceof Error ? error.message : "Race history did not save.",
          });
        }
        return false;
      }
      return true;
    },
    [context, project?.title, race, record, reports, currentHeat, baseCommit],
  );
}
