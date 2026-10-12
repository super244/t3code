/* agent-watermark: model=opus-5.5; effort=high; duration=110m; seat=claude-code; date=2026-10-04 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
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
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRightIcon, CheckIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useUiStateStore } from "../../uiStateStore";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { raceModelLabel, raceProviderLabel } from "./RaceComposer";
import {
  canKeepRaceEntrant,
  describeRaceKeepResult,
  raceKeepConfirmation,
  raceEntrantPhase,
  type RaceEntrant,
  type RaceEntrantPhase,
  type RaceGroup,
} from "./race.logic";

type Race = RaceGroup<EnvironmentThreadShell>;
type Entrant = RaceEntrant<EnvironmentThreadShell>;

// Literal classes so Tailwind sees them; a column per entrant on wide screens.
const GRID_COLUMNS: Record<number, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-2 xl:grid-cols-4",
};

const PHASE_PRESENTATION: Record<
  RaceEntrantPhase,
  { readonly label: string; readonly colorClass: string; readonly dotClass: string }
> = {
  preparing: {
    label: "Preparing",
    colorClass: "text-muted-foreground",
    dotClass: "bg-muted-foreground/45",
  },
  working: {
    label: "Working",
    colorClass: "text-sky-600 dark:text-sky-300/80",
    dotClass: "bg-sky-500 dark:bg-sky-300/80",
  },
  attention: {
    label: "Needs you",
    colorClass: "text-amber-600 dark:text-amber-300/90",
    dotClass: "bg-amber-500 dark:bg-amber-300/90",
  },
  failed: {
    label: "Failed",
    colorClass: "text-destructive",
    dotClass: "bg-destructive",
  },
  finished: {
    label: "Finished",
    colorClass: "text-emerald-600 dark:text-emerald-300/90",
    dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
  },
};

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

export function RaceCard({ race, context }: { race: Race; context: RaceBoardContext }) {
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
  const finishedCount = race.entrants.filter(
    (entrant) => raceEntrantPhase(entrant.thread) === "finished",
  ).length;

  const entrantLabel = (entrant: Entrant) => {
    const provider = context.providersByKey.get(
      `${race.environmentId}\0${entrant.thread.modelSelection.instanceId}`,
    );
    return `${provider ? raceProviderLabel(provider) : entrant.thread.modelSelection.instanceId} ${raceModelLabel(provider, entrant.thread.modelSelection.model)}`;
  };

  const discardEntrants = async (entrants: ReadonlyArray<Entrant>) => {
    let failed = 0;
    for (const entrant of entrants) {
      const result = await deleteThread(scopeThreadRef(race.environmentId, entrant.thread.id), {
        worktree: "delete",
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) failed += 1;
    }
    return failed;
  };

  const discard = async (entrant: Entrant) => {
    if (pendingThreadId !== null) return;
    const confirmed = await settlePromise(() =>
      confirmAction(
        [
          `Discard ${entrantLabel(entrant)}?`,
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

  const keep = async (entrant: Entrant) => {
    if (pendingThreadId !== null || !project) return;
    const { worktreePath, branch } = entrant.thread;
    if (!worktreePath || !branch) return;
    const others = race.entrants.filter((other) => other.thread.id !== entrant.thread.id);
    const previouslyKept = keptEntrantByRace.get(race.key);
    const confirmed = await settlePromise(() =>
      confirmAction(
        raceKeepConfirmation({
          entrantLabel: entrantLabel(entrant),
          target: checkoutBranch ?? "the project checkout",
          otherCount: others.length,
          previouslyKeptLabel:
            previouslyKept && previouslyKept.threadId !== entrant.thread.id
              ? previouslyKept.label
              : null,
        }),
      ),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
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
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not keep this entrant",
          description: error instanceof Error ? error.message : "The merge did not run.",
        });
        return;
      }
      const message = describeRaceKeepResult(result.value, checkoutBranch);
      if (message.discardOthers) {
        keptEntrantByRace.set(race.key, {
          threadId: entrant.thread.id,
          label: entrantLabel(entrant),
        });
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
        return;
      }
      toastManager.add({
        type: message.tone,
        title: message.title,
        description: message.description,
      });
    } finally {
      setPendingThreadId(null);
    }
  };

  return (
    <section
      aria-label={race.titleSeed}
      className="flex min-w-0 flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{race.titleSeed}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {project?.title ?? "Unknown project"}
            {context.environmentLabels.size > 1
              ? ` · ${context.environmentLabels.get(race.environmentId) ?? "Computer"}`
              : ""}{" "}
            · {formatRelativeTimeLabel(race.startedAt)}
          </p>
        </div>
        {race.entrants.length < race.count ? (
          <Badge variant="secondary">
            <span className="tabular-nums">
              {race.entrants.length} of {race.count}
            </span>{" "}
            left
          </Badge>
        ) : (
          <Badge variant={finishedCount === race.entrants.length ? "secondary" : "info"}>
            <span className="tabular-nums">
              {finishedCount}/{race.count}
            </span>{" "}
            finished
          </Badge>
        )}
      </header>
      <div
        className={cn(
          "grid min-w-0 gap-3 sm:grid-cols-2",
          GRID_COLUMNS[race.count] ?? "lg:grid-cols-2",
        )}
      >
        {race.entrants.map((entrant) => (
          <EntrantCard
            key={entrant.thread.id}
            entrant={entrant}
            provider={
              context.providersByKey.get(
                `${race.environmentId}\0${entrant.thread.modelSelection.instanceId}`,
              ) ?? null
            }
            busy={pendingThreadId !== null}
            pending={pendingThreadId === entrant.thread.id}
            keepTarget={checkoutBranch}
            onKeep={() => void keep(entrant)}
            onDiscard={() => void discard(entrant)}
          />
        ))}
      </div>
    </section>
  );
}

function EntrantCard({
  entrant,
  provider,
  busy,
  pending,
  keepTarget,
  onKeep,
  onDiscard,
}: {
  entrant: Entrant;
  provider: ServerProvider | null;
  busy: boolean;
  pending: boolean;
  keepTarget: string | null;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const { thread } = entrant;
  const navigate = useNavigate();
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const lastVisitedAt = useUiStateStore(
    (state) => state.threadLastVisitedAtById[scopedThreadKey(threadRef)],
  );
  const worktreeStatus = useEnvironmentQuery(
    thread.worktreePath
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: thread.worktreePath },
        })
      : null,
  );
  const phase = raceEntrantPhase(thread);
  const pill = resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt } });
  const status = pill
    ? { label: pill.label, colorClass: pill.colorClass, dotClass: pill.dotClass }
    : PHASE_PRESENTATION[phase];
  const ProviderIcon = provider ? PROVIDER_ICON_BY_PROVIDER[provider.driver] : undefined;
  const workingTree = worktreeStatus.data?.workingTree;
  const keepable = canKeepRaceEntrant(thread);

  return (
    <article
      aria-label={`Entrant ${entrant.slot}`}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-3 shadow-xs",
        pending && "opacity-64",
      )}
    >
      <header className="flex min-w-0 items-start gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {ProviderIcon ? (
            <ProviderIcon className="size-4" />
          ) : (
            <span className="text-xs font-medium tabular-nums">{entrant.slot}</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {provider ? raceProviderLabel(provider) : thread.modelSelection.instanceId}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {raceModelLabel(provider ?? undefined, thread.modelSelection.model)}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
            status.colorClass,
          )}
        >
          <span className={cn("size-1.5 rounded-full", status.dotClass)} />
          {status.label}
        </span>
      </header>

      <dl className="flex min-w-0 items-baseline gap-3 text-xs tabular-nums">
        {workingTree ? (
          <>
            <div className="flex items-baseline gap-1">
              <dt className="sr-only">Insertions</dt>
              <dd className="text-success">+{workingTree.insertions}</dd>
            </div>
            <div className="flex items-baseline gap-1">
              <dt className="sr-only">Deletions</dt>
              <dd className="text-destructive">−{workingTree.deletions}</dd>
            </div>
            <div className="flex items-baseline gap-1 text-muted-foreground">
              <dd>{workingTree.files.length}</dd>
              <dt>{workingTree.files.length === 1 ? "file" : "files"}</dt>
            </div>
          </>
        ) : (
          <dd className="text-muted-foreground">
            {thread.worktreePath ? "Reading changes…" : "Creating worktree…"}
          </dd>
        )}
      </dl>

      <footer className="flex min-w-0 items-center gap-1.5">
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
            aria-label={keepable ? undefined : "Available when the entrant finishes"}
          >
            <Button size="sm" disabled={busy || !keepable} onClick={onKeep}>
              <CheckIcon /> {pending ? "Keeping…" : "Keep"}
            </Button>
          </TooltipTrigger>
          <TooltipPopup side="top">
            {keepable
              ? `Merge into ${keepTarget ?? "the project checkout"} and discard the rest`
              : "Available when the entrant finishes"}
          </TooltipPopup>
        </Tooltip>
      </footer>
    </article>
  );
}
