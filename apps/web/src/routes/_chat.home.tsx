/* agent-watermark: model=haiku-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-12 */
import { createFileRoute } from "@tanstack/react-router";

import { NoActiveThreadState } from "../components/NoActiveThreadState";

/**
 * The launchpad as a destination of its own. `/` still opens a draft (see
 * `_chat.index.tsx`), so this route is how a person reaches the launchpad on
 * purpose: from the sidebar Home entry, the command palette, or the
 * `launchpad.open` shortcut.
 */
function LaunchpadRouteView() {
  return <NoActiveThreadState />;
}

export const Route = createFileRoute("/_chat/home")({
  component: LaunchpadRouteView,
});
