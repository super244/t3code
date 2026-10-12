/* agent-watermark: model=opus-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-12 */
import { UpstreamUpdateHub } from "./UpstreamUpdateHub";
import { setUpstreamHubOpen, useUpstreamHubOpen } from "./upstreamHubStore";
import { useUpstreamTracker } from "./upstreamTracker";

/** Mounted once at the app root; the pill and the palette only ask it to open. */
export function UpstreamHubHost() {
  const open = useUpstreamHubOpen();
  const { status, checkNow } = useUpstreamTracker();
  return (
    <UpstreamUpdateHub
      open={open}
      onOpenChange={setUpstreamHubOpen}
      status={status}
      onCheckNow={checkNow}
    />
  );
}
