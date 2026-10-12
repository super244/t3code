/* agent-watermark: model=opus-5.5; effort=high; duration=25m; seat=claude-code; date=2026-10-12 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import { Zap } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { SIDEBAR_STATUS_PILL } from "../sidebar/statusPill";
import { openUpstreamHub } from "./upstreamHubStore";
import { useUpstreamTracker } from "./upstreamTracker";

export function UpstreamUpdatePill({ className }: { className?: string }) {
  const { status } = useUpstreamTracker();

  const hasNew = status.hasNewRelease;
  const version = status.latestRelease?.tagName ?? `v${status.currentVersion}`;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label="View upstream releases and downloads"
              data-slot="upstream-update-pill"
              onClick={openUpstreamHub}
              type="button"
              className={cn(
                "group relative",
                SIDEBAR_STATUS_PILL,
                hasNew && "border-warning/30 bg-warning/10 text-warning hover:bg-warning/15",
                className,
              )}
            >
              {hasNew ? (
                <>
                  <span className="relative flex size-2">
                    <span className="relative inline-flex size-2 rounded-full bg-warning" />
                  </span>
                  <span className="font-semibold text-warning-foreground">Upstream {version}</span>
                  <span className="rounded bg-warning/16 px-1 text-[9px] font-semibold text-warning-foreground">
                    NEW
                  </span>
                </>
              ) : (
                <>
                  <Zap className="size-3 text-sky-400" />
                  <span className="font-mono tabular-nums">v{status.currentVersion}</span>
                </>
              )}
            </button>
          }
        />
        <TooltipPopup side="bottom">
          {hasNew
            ? `New Upstream Release Available (${version})! Click to view changelog & downloads.`
            : status.error
              ? `Upstream check failed: ${status.error}`
              : status.checkedAt
                ? "View last checked upstream releases and downloads"
                : "Upstream releases have not been checked yet"}
        </TooltipPopup>
      </Tooltip>
    </>
  );
}
