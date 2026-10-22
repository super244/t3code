/* agent-watermark: model=opus-5.5; effort=high; duration=4m; seat=claude-code; date=2026-10-19 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { raceHeats } from "@t3tools/shared/raceHistory";

import { useEnvironmentQuery } from "../../state/query";
import { raceHistoryEnvironment } from "../../state/raceHistory";
import type { RaceGroup } from "./race.logic";

/**
 * A race's history record and the heat it is on now: 1 for the original race,
 * then one more for each rematch started on it.
 */
export function useRaceHistoryRecord(race: RaceGroup<EnvironmentThreadShell>) {
  const history = useEnvironmentQuery(
    raceHistoryEnvironment.list({ environmentId: race.environmentId, input: {} }),
  );
  const recorded = history.data?.records.find((item) => item.raceId === race.raceId) ?? null;
  const heats = recorded ? raceHeats(recorded) : [];
  const currentHeat = heats.at(-1)?.heat ?? 1;
  const currentHeatView = heats.find((heat) => heat.heat === currentHeat) ?? null;
  return {
    history,
    historyLoaded: history.data !== null,
    recorded,
    currentHeat,
    currentHeatView,
  };
}
