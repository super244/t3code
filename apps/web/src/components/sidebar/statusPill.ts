/* agent-watermark: model=opus-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-12 */
// One shape for the sidebar footer's status chips (upstream, sound, theme) so the
// row reads as a single status bar rather than three unrelated badges.
export const SIDEBAR_STATUS_PILL =
  "inline-flex h-6 min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
