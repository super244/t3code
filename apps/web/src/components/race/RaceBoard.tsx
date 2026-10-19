/* agent-watermark: model=opus-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-18 */
/* agent-watermark: model=opus-5.5; effort=high; duration=110m; seat=claude-code; date=2026-10-04 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ServerProvider } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRightIcon, CheckIcon, ColumnsIcon, Trash2Icon } from "lucide-react";

import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useUiStateStore } from "../../uiStateStore";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { raceModelLabel, raceProviderLabel } from "./RaceComposer";
import {
  canKeepRaceEntrant,
  raceEntrantPhase,
  type RaceEntrant,
  type RaceEntrantPhase,
  type RaceGroup,
} from "./race.logic";
import {
  raceEntrantProvider,
  useRaceEntrantActions,
  type RaceBoardContext,
} from "./useRaceEntrantActions";

type Race = RaceGroup<EnvironmentThreadShell>;
type Entrant = RaceEntrant<EnvironmentThreadShell>;

// Literal classes so Tailwind sees them; a column per entrant on wide screens.
const GRID_COLUMNS: Record<number, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-2 xl:grid-cols-4",
};

export const PHASE_PRESENTATION: Record<
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

export type { RaceBoardContext };

export function RaceCard({ race, context }: { race: Race; context: RaceBoardContext }) {
  const navigate = useNavigate();
  const { project, checkoutBranch, pendingThreadId, keep, discard } = useRaceEntrantActions(
    race,
    context,
  );
  const finishedCount = race.entrants.filter(
    (entrant) => raceEntrantPhase(entrant.thread) === "finished",
  ).length;

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
        <div className="flex shrink-0 items-center gap-2">
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
          <Button
            size="sm"
            variant="outline"
            aria-label={`Compare entrants: ${race.titleSeed}`}
            onClick={() =>
              void navigate({
                to: "/race",
                search: { race: race.raceId, env: race.environmentId },
              })
            }
          >
            <ColumnsIcon /> Compare
          </Button>
        </div>
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
            provider={raceEntrantProvider(race, entrant, context)}
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
