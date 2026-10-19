/* agent-watermark: model=opus-5.5; effort=high; duration=3m; seat=claude-code; date=2026-10-18 */
/* agent-watermark: model=opus-5.5; effort=high; duration=72m; seat=claude-code; date=2026-10-04 */
import { createFileRoute } from "@tanstack/react-router";

import { RacePage } from "../components/race/RacePage";

export interface RaceSearch {
  /** Race id to open in the arena; the board shows when absent. */
  readonly race?: string;
  /** Environment that owns the race. */
  readonly env?: string;
}

export const Route = createFileRoute("/race")({
  validateSearch: (raw: Record<string, unknown>): RaceSearch => ({
    ...(typeof raw.race === "string" && /^[0-9a-z]{6}$/.test(raw.race) ? { race: raw.race } : {}),
    ...(typeof raw.env === "string" && raw.env.length > 0 ? { env: raw.env } : {}),
  }),
  component: RaceRoute,
});

function RaceRoute() {
  const { race, env } = Route.useSearch();
  return <RacePage arenaRaceId={race ?? null} arenaEnvironmentId={env ?? null} />;
}
