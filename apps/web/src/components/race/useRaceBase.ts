/* agent-watermark: model=opus-5.5; effort=high; duration=4m; seat=claude-code; date=2026-10-19 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import { useEnvironmentQuery } from "../../state/query";
import { raceHistoryEnvironment } from "../../state/raceHistory";
import type { RaceGroup } from "./race.logic";

/**
 * The commit a race started from. Any entrant still on its race branch can
 * answer: git remembers where the branch was created, even after the entrant
 * committed and Keep moved the base branch on.
 */
export function useRaceBase(race: RaceGroup<EnvironmentThreadShell>) {
  const source =
    race.entrants.find((entrant) => entrant.thread.worktreePath && entrant.thread.branch) ?? null;
  const query = useEnvironmentQuery(
    source?.thread.worktreePath && source.thread.branch
      ? raceHistoryEnvironment.resolveBase({
          environmentId: race.environmentId,
          input: { cwd: source.thread.worktreePath, branch: source.thread.branch },
        })
      : null,
  );
  return {
    commit: query.data?.commit ?? null,
    error: query.error,
    loading: query.isPending && query.data === null,
  };
}
