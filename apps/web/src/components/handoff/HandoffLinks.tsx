/* agent-watermark: model=opus-5.5; effort=high; duration=60m; seat=claude-code; date=2026-10-05 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { findHandoffsFrom, parseHandoffSource } from "@t3tools/shared/handoff";
import { Link } from "@tanstack/react-router";
import { CornerDownRightIcon, CornerLeftUpIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useThreadShells } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";

interface HandoffLinksThread {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly title: string;
  readonly worktreePath: string | null;
  readonly createdAt: string;
  readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
}

const pillClass =
  "pointer-events-auto inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-xs backdrop-blur hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/**
 * The two ends of a handoff: a continuation links back to the thread it
 * picked up from, and the original lists the threads that continued it.
 */
export const HandoffLinks = memo(function HandoffLinks({ thread }: { thread: HandoffLinksThread }) {
  const shells = useThreadShells();
  const firstUserText = thread.messages.find((message) => message.role === "user")?.text ?? null;
  const sourceId = parseHandoffSource(firstUserText);
  const source = useMemo(
    () =>
      sourceId
        ? shells.find(
            (shell) => shell.environmentId === thread.environmentId && shell.id === sourceId,
          )
        : undefined,
    [shells, sourceId, thread.environmentId],
  );
  const continuations = useMemo(() => findHandoffsFrom(thread, shells), [shells, thread]);

  if (!source && continuations.length === 0) return null;
  return (
    <div className="mx-auto flex w-fit max-w-[min(48rem,calc(100%-2rem))] flex-wrap justify-center gap-1.5 pt-2">
      {source ? (
        <Link
          className={pillClass}
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(source.environmentId, source.id))}
        >
          <CornerLeftUpIcon className="size-3.5 shrink-0" />
          <span className="truncate">Continued from {source.title}</span>
        </Link>
      ) : null}
      {continuations.map((next) => (
        <Link
          key={next.id}
          className={pillClass}
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(next.environmentId, next.id))}
        >
          <CornerDownRightIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            Continued with {next.modelSelection.model} ·{" "}
            {new Date(next.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        </Link>
      ))}
    </div>
  );
});
