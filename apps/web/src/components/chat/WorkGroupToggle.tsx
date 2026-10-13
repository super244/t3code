/* agent-watermark: model=haiku-5.5; effort=high; duration=28m; seat=claude-code; date=2026-10-12 */
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { TruncatedText } from "../TruncatedText";

/**
 * One line that stands for a run of consecutive tool calls: the run's summary,
 * how many of its calls failed, and whether the per-call rows are open.
 * Failures read as a quiet status, because ordinary tool failures are not errors
 * of the turn; the per-call rows keep their own marks.
 */
export function WorkGroupToggle(props: {
  summary: string;
  icon: ReactNode;
  expanded: boolean;
  failedCount: number;
  onToggle: () => void;
}) {
  const { summary, icon, expanded, failedCount, onToggle } = props;
  const failedLabel = `${failedCount} failed`;
  const ExpandIcon = expanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <button
      type="button"
      className="group/tool-group flex min-h-6 w-full cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-sm leading-relaxed transition-colors duration-150 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      aria-label={failedCount > 0 ? `${summary}, ${failedLabel}` : undefined}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="flex size-6 shrink-0 items-center justify-center text-icon-muted">
        {icon}
      </span>
      <TruncatedText text={summary} className="min-w-0 flex-1 truncate text-secondary-label" />
      {failedCount > 0 ? (
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{failedLabel}</span>
      ) : null}
      <ExpandIcon
        aria-hidden
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground/60 transition-colors duration-150",
          "group-hover/tool-group:text-muted-foreground",
        )}
      />
    </button>
  );
}
