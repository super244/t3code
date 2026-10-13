/* agent-watermark: model=haiku-5.5; effort=high; duration=55m; seat=claude-code; date=2026-10-12 */
/* agent-watermark: model=muse-spark; effort=high; duration=25m; seat=opencode; date=2026-10-10 */
import { memo, useEffect } from "react";
import { type PendingApproval } from "../../session-logic";
import { cn } from "~/lib/utils";
import { playSound } from "../../lib/soundEffects";
import { AppWindowIcon, EyeIcon, FileDiffIcon, TerminalIcon } from "lucide-react";
import { TruncatedText } from "../TruncatedText";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  className?: string;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  className,
}: ComposerPendingApprovalPanelProps) {
  useEffect(() => {
    playSound("approval-requested");
  }, [approval.requestId]);

  const fallbackLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access approval"
      : approval.requestKind === "command"
        ? "Command approval"
        : approval.requestKind === "file-read"
          ? "File read approval"
          : "File change approval";
  const detailAriaLabel =
    approval.requestKind === "mcp-elicitation"
      ? "App access request"
      : approval.requestKind === "command"
        ? "Command"
        : approval.requestKind === "file-read"
          ? "File to read"
          : "File change";
  const KindIcon =
    approval.requestKind === "command"
      ? TerminalIcon
      : approval.requestKind === "file-read"
        ? EyeIcon
        : approval.requestKind === "mcp-elicitation"
          ? AppWindowIcon
          : FileDiffIcon;

  return (
    <span
      aria-label={fallbackLabel}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-warning/30 bg-warning/8 px-2.5 py-2",
        className,
      )}
      role="group"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-warning/15 text-warning">
        <KindIcon aria-hidden="true" className="size-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[11px] font-medium text-foreground">{fallbackLabel}</span>
          {approval.appName ? (
            <TruncatedText
              text={approval.appName}
              className="max-w-32 shrink truncate text-[11px] text-muted-foreground"
            />
          ) : null}
          {pendingCount > 1 ? (
            <span className="ml-auto shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
              1/{pendingCount}
            </span>
          ) : null}
        </span>
        <code
          aria-label={detailAriaLabel}
          className="block max-h-20 min-w-0 flex-1 overflow-auto rounded-md bg-muted/40 px-2 py-1.5 whitespace-pre font-mono text-[11px] leading-relaxed text-foreground/85 [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-scrollbar]:h-1.5"
          data-approval-detail="complete"
          tabIndex={0}
        >
          {approval.detail || fallbackLabel}
        </code>
      </span>
    </span>
  );
});
