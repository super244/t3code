/* agent-watermark: model=opus-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-18 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { ServerProvider } from "@t3tools/contracts";
import { useCallback, useState } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { readLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { toastManager } from "../ui/toast";
import { formatRaceAgentLabel } from "./raceLabels";
import {
  describeRaceKeepResult,
  raceKeepConfirmation,
  type RaceEntrant,
  type RaceGroup,
} from "./race.logic";

type Race = RaceGroup<EnvironmentThreadShell>;
type Entrant = RaceEntrant<EnvironmentThreadShell>;

export interface RaceBoardContext {
  readonly projectsByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly providersByKey: ReadonlyMap<string, ServerProvider>;
  readonly environmentLabels: ReadonlyMap<string, string>;
}

// Entrants merged by Keep this session, per race. Losers can survive a Keep
// when their discard fails, so a second Keep must say it stacks another squash.
const keptEntrantByRace = new Map<string, { readonly threadId: string; readonly label: string }>();

function confirmAction(message: string): Promise<boolean> {
  const localApi = readLocalApi();
  if (!localApi) return Promise.resolve(false);
  return localApi.dialogs.confirm(message, { variant: "destructive" });
}

export function raceEntrantProvider(
  race: Pick<Race, "environmentId">,
  entrant: Entrant,
  context: RaceBoardContext,
): ServerProvider | null {
  return (
    context.providersByKey.get(
      `${race.environmentId}\0${entrant.thread.modelSelection.instanceId}`,
    ) ?? null
  );
}

export function raceEntrantLabel(
  race: Pick<Race, "environmentId">,
  entrant: Entrant,
  context: RaceBoardContext,
): string {
  return formatRaceAgentLabel(
    raceEntrantProvider(race, entrant, context),
    entrant.thread.modelSelection,
  );
}

/**
 * Keep and Discard for a race's entrants, shared by the board and the arena so
 * both apply the same guards, confirmations and toasts.
 */
export function useRaceEntrantActions(race: Race, context: RaceBoardContext) {
  const project = context.projectsByKey.get(`${race.environmentId}\0${race.projectId}`) ?? null;
  const { deleteThread } = useThreadActions();
  const integrateWorktree = useAtomCommand(vcsEnvironment.integrateWorktree, {
    reportFailure: false,
  });
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const checkoutStatus = useEnvironmentQuery(
    project
      ? vcsEnvironment.status({
          environmentId: race.environmentId,
          input: { cwd: project.workspaceRoot },
        })
      : null,
  );
  const checkoutBranch = checkoutStatus.data?.refName ?? null;

  const discardEntrants = useCallback(
    async (entrants: ReadonlyArray<Entrant>) => {
      let failed = 0;
      for (const entrant of entrants) {
        const result = await deleteThread(scopeThreadRef(race.environmentId, entrant.thread.id), {
          worktree: "delete",
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) failed += 1;
      }
      return failed;
    },
    [deleteThread, race.environmentId],
  );

  const discard = async (entrant: Entrant) => {
    if (pendingThreadId !== null) return;
    const confirmed = await settlePromise(() =>
      confirmAction(
        [
          `Discard ${raceEntrantLabel(race, entrant, context)}?`,
          "This deletes the entrant's thread and its worktree, including uncommitted changes.",
        ].join("\n"),
      ),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    setPendingThreadId(entrant.thread.id);
    try {
      const failed = await discardEntrants([entrant]);
      if (failed > 0) {
        toastManager.add({ type: "error", title: "Could not fully discard the entrant" });
      }
    } finally {
      setPendingThreadId(null);
    }
  };

  /** Resolves true when the entrant was merged into the checkout. */
  const keep = async (entrant: Entrant): Promise<boolean> => {
    if (pendingThreadId !== null || !project) return false;
    const { worktreePath, branch } = entrant.thread;
    if (!worktreePath || !branch) return false;
    const label = raceEntrantLabel(race, entrant, context);
    const others = race.entrants.filter((other) => other.thread.id !== entrant.thread.id);
    const previouslyKept = keptEntrantByRace.get(race.key);
    const confirmed = await settlePromise(() =>
      confirmAction(
        raceKeepConfirmation({
          entrantLabel: label,
          target: checkoutBranch ?? "the project checkout",
          otherCount: others.length,
          previouslyKeptLabel:
            previouslyKept && previouslyKept.threadId !== entrant.thread.id
              ? previouslyKept.label
              : null,
        }),
      ),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return false;
    setPendingThreadId(entrant.thread.id);
    try {
      const result = await integrateWorktree({
        environmentId: race.environmentId,
        input: {
          cwd: project.workspaceRoot,
          worktreePath,
          branch,
          commitMessage: `race: ${race.titleSeed}`,
        },
      });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return false;
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not keep this entrant",
          description: error instanceof Error ? error.message : "The merge did not run.",
        });
        return false;
      }
      const message = describeRaceKeepResult(result.value, checkoutBranch);
      if (message.discardOthers) {
        keptEntrantByRace.set(race.key, { threadId: entrant.thread.id, label });
        const failed = await discardEntrants(others);
        toastManager.add({
          type: failed > 0 ? "warning" : message.tone,
          title: message.title,
          description:
            failed > 0
              ? `${message.description} ${failed} of ${others.length} other entrants could not be fully discarded.`
              : others.length > 0
                ? `${message.description} The other entrants were discarded.`
                : message.description,
        });
        return true;
      }
      toastManager.add({
        type: message.tone,
        title: message.title,
        description: message.description,
      });
      return false;
    } finally {
      setPendingThreadId(null);
    }
  };

  return { project, checkoutBranch, pendingThreadId, keep, discard };
}
