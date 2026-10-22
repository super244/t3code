/* agent-watermark: model=opus-5.5; effort=high; duration=2m; seat=claude-code; date=2026-10-22 */
import { useMemo } from "react";

import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import type { RaceBoardContext } from "./useRaceEntrantActions";

/** Projects, providers and environment labels by key, as every race view reads them. */
export function useRaceBoardContext(): RaceBoardContext {
  const projects = useProjects();
  const { environments } = useEnvironments();
  return useMemo<RaceBoardContext>(
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
}
