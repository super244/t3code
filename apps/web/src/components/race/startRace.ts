/* agent-watermark: model=opus-5.5; effort=high; duration=8m; seat=claude-code; date=2026-10-19 */
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type ProjectId,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import { buildRaceBranchName } from "@t3tools/shared/race";
import { truncate } from "@t3tools/shared/String";

import { buildRaceEntrantTitle } from "./race.logic";
import { formatRaceAgentLabel, raceEffortDescriptor } from "./raceLabels";

export interface RaceStartEntrant {
  readonly provider: ServerProvider;
  readonly model: string;
  readonly effort?: string | null;
}

/** A rematch appends entrants after the race's existing slots. */
export interface RaceStartAppend {
  readonly existingCount: number;
}

/**
 * One bootstrap turn per entrant, shaped like ChatView's first send in
 * worktree mode; the server creates each worktree on its race branch. Shared
 * by the Race page and "Race this prompt" so both start races the same way.
 */
export function buildRaceStartTurns(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectCwd: string;
  readonly baseBranch: string;
  readonly prompt: string;
  readonly raceId: string;
  readonly entrants: ReadonlyArray<RaceStartEntrant>;
  readonly createdAt: string;
  readonly newThreadId: () => ThreadId;
  readonly newMessageId: () => MessageId;
  readonly append?: RaceStartAppend;
}) {
  const text = input.prompt.trim();
  const titleSeed = truncate(text);
  const offset = input.append?.existingCount ?? 0;
  const count = offset + input.entrants.length;
  return input.entrants.map((entrant, index) => {
    const effortDescriptor = entrant.effort
      ? raceEffortDescriptor(entrant.provider, entrant.model)
      : null;
    const modelSelection: ModelSelection = {
      instanceId: entrant.provider.instanceId,
      model: entrant.model,
      ...(effortDescriptor && entrant.effort
        ? { options: [{ id: effortDescriptor.id, value: entrant.effort }] }
        : {}),
    };
    const title = buildRaceEntrantTitle(
      titleSeed,
      formatRaceAgentLabel(entrant.provider, modelSelection),
    );
    return {
      environmentId: input.environmentId,
      input: {
        threadId: input.newThreadId(),
        message: {
          messageId: input.newMessageId(),
          role: "user" as const,
          text,
          attachments: [],
        },
        modelSelection,
        // The bare seed differs from the suffixed title, so the server keeps
        // "<seed> · <entrant>" instead of generating a new title.
        titleSeed,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        bootstrap: {
          createThread: {
            projectId: input.projectId,
            title,
            modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: input.baseBranch,
            worktreePath: null,
            createdAt: input.createdAt,
          },
          prepareWorktree: {
            projectCwd: input.projectCwd,
            baseBranch: input.baseBranch,
            branch: buildRaceBranchName({ raceId: input.raceId, slot: offset + index + 1, count }),
          },
          runSetupScript: true,
        },
        createdAt: input.createdAt,
      },
    };
  });
}
