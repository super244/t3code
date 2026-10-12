/* agent-watermark: model=opus-5.5; effort=high; duration=72m; seat=claude-code; date=2026-10-04 */
import { createFileRoute } from "@tanstack/react-router";

import { RacePage } from "../components/race/RacePage";

export const Route = createFileRoute("/race")({
  component: RacePage,
});
