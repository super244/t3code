/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import { useState } from "react";
import { Zap } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { UpstreamUpdateHub } from "./UpstreamUpdateHub";
import { useUpstreamTracker } from "./upstreamTracker";

export function UpstreamUpdatePill({ className }: { className?: string }) {
  const { status, checkNow } = useUpstreamTracker();
  const [hubOpen, setHubOpen] = useState(false);

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
              onClick={() => setHubOpen(true)}
              type="button"
              className={cn(
                "group relative inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                hasNew
                  ? "bg-warning/10 border border-warning/30 text-warning hover:bg-warning/15"
                  : "bg-surface/80 border border-border/60 text-muted-foreground hover:text-foreground hover:border-border hover:bg-surface backdrop-blur",
                className,
              )}
            >
              {hasNew ? (
                <>
                  <span className="relative flex size-2">
                    <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
                  </span>
                  <span className="font-semibold text-amber-400">Upstream {version}</span>
                  <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-bold text-amber-300">
                    NEW
                  </span>
                </>
              ) : (
                <>
                  <Zap className="size-3 text-sky-400 group-hover:scale-110 transition-transform" />
                  <span className="font-medium text-foreground/80">Upstream</span>
                  <span className="text-[10px] text-muted-foreground/80 font-mono">
                    v{status.currentVersion}
                  </span>
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

      <UpstreamUpdateHub
        open={hubOpen}
        onOpenChange={setHubOpen}
        status={status}
        onCheckNow={checkNow}
      />
    </>
  );
}
