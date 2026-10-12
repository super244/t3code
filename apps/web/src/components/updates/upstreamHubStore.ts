/* agent-watermark: model=opus-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-12 */
// One open/closed state for the Upstream hub, so the sidebar pill and the command
// palette open the same dialog — and the palette can open it on a phone, where the
// sidebar footer (and its pill) is not rendered.
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function publish(next: boolean) {
  if (open === next) return;
  open = next;
  listeners.forEach((listener) => listener());
}

export const openUpstreamHub = () => publish(true);
export const setUpstreamHubOpen = (next: boolean) => publish(next);

export function useUpstreamHubOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => open,
  );
}
