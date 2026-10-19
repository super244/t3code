/* agent-watermark: model=opus-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-19 */
import type {
  ProjectId,
  RaceEntrantOutcomePhase,
  RaceHistoryJudge,
  RaceHistoryOutcome,
  RaceHistoryRecordInput,
  RaceTaskKind,
  RaceTaskKindSource,
} from "@t3tools/contracts";
import { guessRaceTaskKind } from "@t3tools/shared/raceHistory";

import type { RaceEntrantChanges } from "./raceArena.logic";

export interface RaceRecordEntrant {
  readonly slot: number;
  readonly instanceId: string;
  readonly driver: string;
  readonly model: string;
  readonly effort?: string | null;
  readonly label: string;
  readonly phase: RaceEntrantOutcomePhase;
  readonly elapsedMs: number | null;
  readonly changes: RaceEntrantChanges | null;
  readonly costUsd: number | null;
  readonly failure: string | null;
}

/**
 * The report a client sends when a race is judged, kept or closed. A kind the
 * user picked travels as `user`; otherwise the prompt's wording is a guess the
 * server lets a later pick replace.
 */
export function buildRaceRecordInput(input: {
  readonly raceId: string;
  readonly projectId: ProjectId;
  readonly projectTitle: string;
  readonly titleSeed: string;
  readonly prompt: string;
  readonly startedAt: string;
  readonly outcome: RaceHistoryOutcome;
  readonly keptSlot: number | null;
  readonly judge: RaceHistoryJudge | null;
  readonly entrants: ReadonlyArray<RaceRecordEntrant>;
  readonly taskKind?: RaceTaskKind | null;
  readonly heat?: number;
  readonly participants?: ReadonlyArray<number>;
  readonly baseCommit?: string | null;
}): RaceHistoryRecordInput {
  const taskKindSource: RaceTaskKindSource = input.taskKind ? "user" : "guessed";
  return {
    raceId: input.raceId,
    projectId: input.projectId,
    projectTitle: input.projectTitle,
    titleSeed: input.titleSeed,
    prompt: input.prompt,
    taskKind: input.taskKind ?? guessRaceTaskKind(input.prompt || input.titleSeed),
    taskKindSource,
    startedAt: input.startedAt,
    outcome: input.outcome,
    keptSlot: input.outcome === "kept" ? input.keptSlot : null,
    judge: input.judge,
    ...(input.heat && input.heat > 1
      ? { heat: input.heat, heatStartedAt: new Date().toISOString() }
      : {}),
    ...(input.participants ? { participants: [...input.participants] } : {}),
    ...(input.baseCommit ? { baseCommit: input.baseCommit } : {}),
    entrants: input.entrants.map((entrant) => ({
      slot: entrant.slot,
      instanceId: entrant.instanceId,
      driver: entrant.driver,
      model: entrant.model,
      ...(entrant.effort ? { effort: entrant.effort } : {}),
      label: entrant.label,
      phase: entrant.phase,
      elapsedMs: entrant.elapsedMs === null ? null : Math.round(entrant.elapsedMs),
      files: entrant.changes?.files.length ?? 0,
      additions: entrant.changes?.additions ?? 0,
      deletions: entrant.changes?.deletions ?? 0,
      costUsd: entrant.costUsd,
      failure: entrant.failure,
    })),
  };
}
