/* agent-watermark: model=haiku-5.5; effort=high; duration=42m; seat=claude-code; date=2026-10-13 */
import { Fragment, type ReactNode } from "react";
import { XIcon } from "lucide-react";

import type { SidebarTurnRecap } from "../../lib/turnRecap";

/**
 * Footer line for a card row's latest turn. Each part is present only when the
 * recap knows it, so an unknown value never shows as a number. Slim rows (Settled
 * and Snoozed) have no footer, so they show no recap. Shared by the sidebar rows
 * and the project home's recap list.
 */
export function SidebarTurnRecapLine(props: { readonly recap: SidebarTurnRecap }) {
  const { recap } = props;
  const parts: Array<{ readonly key: string; readonly node: ReactNode }> = [];
  if (recap.filesLabel !== null) {
    parts.push({ key: "files", node: <span>{recap.filesLabel}</span> });
  }
  if (
    recap.additions !== null &&
    recap.deletions !== null &&
    recap.additions + recap.deletions > 0
  ) {
    parts.push({
      key: "stat",
      node: (
        <span className="font-mono">
          <span className="text-emerald-600 dark:text-emerald-400">+{recap.additions}</span>{" "}
          <span className="text-red-600 dark:text-red-400">−{recap.deletions}</span>
        </span>
      ),
    });
  }
  if (recap.durationLabel !== null) {
    parts.push({ key: "duration", node: <span>{recap.durationLabel}</span> });
  }
  if (recap.failedCommandCount > 0) {
    parts.push({
      key: "failed",
      node: (
        <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400">
          <XIcon aria-hidden className="size-3" />
          {recap.failedCommandCount}
          <span className="sr-only">
            {recap.failedCommandCount === 1 ? "failed command" : "failed commands"}
          </span>
        </span>
      ),
    });
  }
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap text-[11px] tabular-nums">
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index > 0 ? (
            <span aria-hidden className="text-muted-foreground/50">
              ·
            </span>
          ) : null}
          {part.node}
        </Fragment>
      ))}
    </span>
  );
}
