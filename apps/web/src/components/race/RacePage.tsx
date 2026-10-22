/* agent-watermark: model=opus-5.5; effort=high; duration=3m; seat=claude-code; date=2026-10-19 */
/* agent-watermark: model=opus-5.5; effort=high; duration=5m; seat=claude-code; date=2026-10-18 */
/* agent-watermark: model=opus-5.5; effort=high; duration=72m; seat=claude-code; date=2026-10-04 */
import { useNavigate } from "@tanstack/react-router";
import { FlagIcon, TrophyIcon } from "lucide-react";
import { useMemo } from "react";

import { isElectron } from "../../env";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { RaceArena } from "./RaceArena";
import { RaceCard, type RaceBoardContext } from "./RaceBoard";
import { RaceComposer } from "./RaceComposer";
import { RaceScoreboard } from "./RaceScoreboard";
import { groupRaces } from "./race.logic";

export function RacePage({
  arenaRaceId = null,
  arenaEnvironmentId = null,
  view = "board",
}: {
  readonly arenaRaceId?: string | null;
  readonly arenaEnvironmentId?: string | null;
  readonly view?: "board" | "scoreboard";
} = {}) {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const shellsReady = useAllEnvironmentShellsBootstrapped();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const races = useMemo(() => groupRaces(threads), [threads]);
  const context = useMemo<RaceBoardContext>(
    () => ({
      projectsByKey: new Map(
        projects.map((project) => [`${project.environmentId}\0${project.id}`, project] as const),
      ),
      providersByKey: new Map(
        environments.flatMap((environment) =>
          (environment.serverConfig?.providers ?? []).map(
            (provider) =>
              [`${environment.environmentId}\0${provider.instanceId}`, provider] as const,
          ),
        ),
      ),
      environmentLabels: new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    }),
    [environments, projects],
  );

  const scoreboardEnvironments = useMemo(
    () =>
      environments.map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.label,
        connected: environment.connection.phase === "connected",
      })),
    [environments],
  );
  const liveRaceKeys = useMemo(
    () => new Set(races.map((race) => `${race.environmentId}\0${race.raceId}`)),
    [races],
  );

  if (arenaRaceId !== null) {
    const race =
      races.find(
        (item) =>
          item.raceId === arenaRaceId &&
          (arenaEnvironmentId === null || item.environmentId === arenaEnvironmentId),
      ) ?? null;
    return (
      <RaceArena
        race={race}
        raceId={arenaRaceId}
        loading={race === null && !shellsReady}
        context={context}
      />
    );
  }

  return (
    <SidebarInset className="isolate h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Race breadcrumb" className="min-w-0 flex-1">
            <WorkspaceBreadcrumbItem>
              <FlagIcon className="size-3.5" />
              <h1>Race</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <ToggleGroup
            aria-label="Race view"
            variant="segmented"
            value={[view]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "board" || value === "scoreboard") {
                void navigate({
                  to: "/race",
                  search: value === "scoreboard" ? { view: "scoreboard" } : {},
                });
              }
            }}
          >
            <Toggle value="board">Races</Toggle>
            <Toggle value="scoreboard">
              <TrophyIcon className="size-3.5" /> Scoreboard
            </Toggle>
          </ToggleGroup>
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          {view === "scoreboard" ? (
            <WorkspacePageContainer width="expanded">
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-medium">Scoreboard</h2>
                <p className="text-xs text-muted-foreground">
                  Every finished race, and which agent you kept for which kind of task.
                </p>
              </div>
              <RaceScoreboard environments={scoreboardEnvironments} liveRaceKeys={liveRaceKeys} />
            </WorkspacePageContainer>
          ) : (
            <WorkspacePageContainer width="expanded">
              <section className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className="text-sm font-medium">New race</h2>
                  <p className="text-xs text-muted-foreground">
                    Run one prompt on several agents at once, each in its own worktree, then keep
                    the best result.
                  </p>
                </div>
                <RaceComposer />
              </section>

              <section className="flex min-w-0 flex-col gap-4">
                <h2 className="text-sm font-medium">
                  Races
                  {races.length > 0 ? (
                    <span className="ml-1.5 text-muted-foreground tabular-nums">
                      {races.length}
                    </span>
                  ) : null}
                </h2>
                {races.length === 0 ? (
                  <p className="border-y border-border py-6 text-center text-sm text-muted-foreground">
                    No races yet. Started races appear here so you can compare entrants and keep
                    one.
                  </p>
                ) : (
                  races.map((race) => <RaceCard key={race.key} race={race} context={context} />)
                )}
              </section>
            </WorkspacePageContainer>
          )}
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}
