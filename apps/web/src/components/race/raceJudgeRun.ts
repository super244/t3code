/* agent-watermark: model=opus-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-22 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { DEFAULT_RUNTIME_MODE, type ModelSelection } from "@t3tools/contracts";
import { buildRaceJudgeBrief, buildRaceJudgeTitle } from "@t3tools/shared/race";

import { newMessageId, newThreadId } from "../../lib/utils";
import { PHASE_PRESENTATION } from "./RaceBoard";
import { raceEntrantPhase, type RaceGroup } from "./race.logic";
import type { EntrantReport } from "./useEntrantReport";
import { raceEntrantLabel, type RaceBoardContext } from "./useRaceEntrantActions";

type Race = RaceGroup<EnvironmentThreadShell>;

/**
 * The bootstrap turn that starts a race's judge: a plan-mode thread in the
 * project checkout with every entrant's diff and final message. Shared by the
 * arena's "Ask the judge" and autopilot, so both brief a judge the same way.
 */
export function buildRaceJudgeTurn(input: {
  readonly race: Race;
  readonly context: RaceBoardContext;
  readonly reports: ReadonlyMap<string, EntrantReport>;
  readonly heat: number;
  readonly checkoutBranch: string | null;
  readonly modelSelection: ModelSelection;
}) {
  const { race, context, reports, heat, checkoutBranch, modelSelection } = input;
  const createdAt = new Date().toISOString();
  const threadId = newThreadId();
  const brief = buildRaceJudgeBrief({
    raceId: race.raceId,
    heat,
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
  // A judge plans instead of editing: plan mode keeps it read-only on
  // providers that honor it, and the brief says so for the rest.
  return {
    threadId,
    command: {
      environmentId: race.environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user" as const, text: brief, attachments: [] },
        modelSelection,
        titleSeed: race.titleSeed,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: "plan" as const,
        bootstrap: {
          createThread: {
            projectId: race.projectId,
            title: buildRaceJudgeTitle(race.titleSeed),
            modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: "plan" as const,
            branch: checkoutBranch,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    },
  };
}

/** What a judge said last: plan mode on some providers answers with a proposed plan instead of a message. */
export function raceJudgeAnswer(thread: {
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
    readonly updatedAt: string;
  }>;
  readonly proposedPlans: ReadonlyArray<{
    readonly planMarkdown: string;
    readonly updatedAt: string;
  }>;
}): string | null {
  const latest = thread.messages.findLast((message) => message.role === "assistant") ?? null;
  const plan = thread.proposedPlans.at(-1) ?? null;
  if (plan && (!latest || plan.updatedAt > latest.updatedAt)) return plan.planMarkdown;
  return latest?.text ?? null;
}
