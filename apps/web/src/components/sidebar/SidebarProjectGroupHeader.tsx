/* agent-watermark: model=haiku-5.5; effort=high; duration=42m; seat=claude-code; date=2026-10-13 */
import { Link } from "@tanstack/react-router";
import { memo, type ReactNode } from "react";

import { projectHomeTarget } from "../project/projectRoutes";

/**
 * The label above one project's active rows in "group by project" mode. The
 * counts are the real working and waiting threads in that project, so an
 * empty status is simply absent rather than shown as zero.
 */
export const SidebarProjectGroupHeader = memo(function SidebarProjectGroupHeader(props: {
  readonly projectKey: string;
  /** Closes the mobile sidebar before the project home opens. */
  readonly onOpen: () => void;
  readonly label: string;
  readonly icon: ReactNode;
  readonly count: number;
  readonly workingCount: number;
  readonly awaitingCount: number;
}) {
  const threadWord = props.count === 1 ? "thread" : "threads";
  return (
    <div className="px-1 pt-2.5 pb-0.5">
      <div
        className="flex h-6 min-w-0 items-center gap-1.5 text-xs text-sidebar-muted-foreground"
        aria-label={`${props.label}, ${props.count} ${threadWord}`}
      >
        <Link
          {...projectHomeTarget(props.projectKey)}
          onClick={props.onOpen}
          aria-label={`Open ${props.label} project home`}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {props.icon}
          <span className="min-w-0 flex-1 truncate font-medium text-sidebar-foreground/80">
            {props.label}
          </span>
        </Link>
        {props.workingCount > 0 ? (
          <span className="shrink-0 text-sky-600 tabular-nums dark:text-sky-300/80">
            {props.workingCount} working
          </span>
        ) : null}
        {props.awaitingCount > 0 ? (
          <span className="shrink-0 text-indigo-600 tabular-nums dark:text-indigo-300/90">
            {props.awaitingCount} waiting
          </span>
        ) : null}
        <span className="shrink-0 tabular-nums">{props.count}</span>
      </div>
    </div>
  );
});
