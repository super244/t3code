/* agent-watermark: model=haiku-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-12 */

/** The launchpad's own address. `/` starts a draft, so this path is the only way to land here on purpose. */
export const LAUNCHPAD_PATH = "/home" as const;

/** True when the sidebar Home entry should read as the current place. */
export function isLaunchpadPath(pathname: string): boolean {
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return normalized === LAUNCHPAD_PATH;
}
