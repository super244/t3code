/* agent-watermark: model=opus-5.5; effort=high; duration=8m; seat=claude-code; date=2026-10-22 */
import type { RaceAutopilotStage } from "@t3tools/contracts";
import type { RaceJudgeVerdict } from "@t3tools/shared/race";

import type { RaceEntrantPhase } from "./race.logic";
import type { RaceJudgePhase } from "./raceArena.logic";

export interface RaceAutopilotInput {
  readonly stage: RaceAutopilotStage;
  readonly keep: boolean;
  /** The heat was already decided (kept or closed), by hand or by another client. */
  readonly decided: boolean;
  readonly entrants: ReadonlyArray<{
    readonly slot: number;
    readonly phase: RaceEntrantPhase;
    /** The entrant's diff has been read at least once since it stopped. */
    readonly loaded: boolean;
    readonly files: number;
  }>;
  /** This heat's judge thread, once one exists. */
  readonly judge: {
    readonly phase: RaceJudgePhase;
    readonly verdict: RaceJudgeVerdict | null;
    readonly error: string | null;
  } | null;
  /** The planned judge's provider is ready on this computer. */
  readonly judgeReady: boolean;
  readonly judgeLabel: string;
}

export type RaceAutopilotStep =
  | { readonly kind: "wait" }
  /** Claim waiting → judging, then start the judge. */
  | { readonly kind: "start-judge"; readonly note: string }
  /** Claim waiting → judging without starting one: someone already asked a judge. */
  | { readonly kind: "adopt-judge"; readonly note: string }
  /** Claim judging → keeping, then merge this entrant. */
  | { readonly kind: "keep"; readonly slot: number }
  | {
      readonly kind: "end";
      readonly from: RaceAutopilotStage;
      readonly to: "done" | "stopped";
      readonly note: string;
    };

const stopped = (phase: RaceEntrantPhase) => phase === "finished" || phase === "failed";

/**
 * What a race on autopilot does next, from what every client can see: the
 * entrants' phases and diffs and the judge's thread. Pure, so each client that
 * runs it reaches the same step; `race.advanceAutopilot` lets only one act.
 */
export function nextRaceAutopilotStep(input: RaceAutopilotInput): RaceAutopilotStep {
  const { stage, entrants, judge } = input;
  if (input.decided && (stage === "waiting" || stage === "judging")) {
    return { kind: "end", from: stage, to: "done", note: "This race was decided by hand." };
  }
  if (stage === "waiting") {
    if (entrants.length === 0) return { kind: "wait" };
    if (!entrants.every((entrant) => stopped(entrant.phase) && entrant.loaded)) {
      return { kind: "wait" };
    }
    if (judge) return { kind: "adopt-judge", note: "A judge was already asked; waiting for it." };
    if (!entrants.some((entrant) => entrant.phase === "finished" && entrant.files > 0)) {
      return {
        kind: "end",
        from: stage,
        to: "stopped",
        note: entrants.every((entrant) => entrant.phase === "failed")
          ? "Every entrant failed, so there was nothing to judge."
          : "No entrant changed any files, so there was nothing to judge.",
      };
    }
    if (!input.judgeReady) {
      return {
        kind: "end",
        from: stage,
        to: "stopped",
        note: `${input.judgeLabel} is not ready on this computer, so no judge was asked.`,
      };
    }
    return { kind: "start-judge", note: `${input.judgeLabel} is judging.` };
  }

  if (stage === "judging") {
    if (!judge) return { kind: "wait" };
    if (judge.phase === "failed") {
      return {
        kind: "end",
        from: stage,
        to: "stopped",
        note: `The judge failed${judge.error ? `: ${judge.error}` : "."} Decide in the arena.`,
      };
    }
    if (judge.phase !== "done") return { kind: "wait" };
    if (judge.verdict === null) {
      return {
        kind: "end",
        from: stage,
        to: "stopped",
        note: "The judge ended without a Winner line. Decide in the arena.",
      };
    }
    if (judge.verdict.kind === "none") {
      return { kind: "end", from: stage, to: "done", note: "The judge kept no entrant." };
    }
    const slot = judge.verdict.slot;
    const pick = entrants.find((entrant) => entrant.slot === slot);
    if (!input.keep) {
      return {
        kind: "end",
        from: stage,
        to: "done",
        note: `The judge picked Entrant ${slot}. Keep it from the arena.`,
      };
    }
    if (!pick || pick.phase !== "finished" || pick.files === 0) {
      return {
        kind: "end",
        from: stage,
        to: "stopped",
        note: `The judge picked Entrant ${slot}, which has nothing to keep. Decide in the arena.`,
      };
    }
    return { kind: "keep", slot };
  }

  return { kind: "wait" };
}

const STAGE_LABELS: Record<RaceAutopilotStage, string> = {
  waiting: "Waiting for every entrant to stop",
  judging: "Judging",
  keeping: "Keeping the judge's pick",
  done: "Finished",
  stopped: "Stopped",
};

/** One line for the arena banner and the board badge. */
export function describeRaceAutopilot(autopilot: {
  readonly stage: RaceAutopilotStage;
  readonly keep: boolean;
  readonly note: string | null;
}): string {
  if (autopilot.stage === "waiting") {
    return autopilot.keep
      ? "When every entrant stops, a judge picks one and it is kept."
      : "When every entrant stops, a judge picks one for you to keep.";
  }
  return autopilot.note ?? STAGE_LABELS[autopilot.stage];
}

export function raceAutopilotStageLabel(stage: RaceAutopilotStage): string {
  return STAGE_LABELS[stage];
}
