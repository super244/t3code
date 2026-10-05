/* agent-watermark: model=opus-5.5; effort=high; duration=90m; seat=claude-code; date=2026-10-05 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ModelSelection, ServerProvider, ThreadId } from "@t3tools/contracts";
import {
  buildFindingsMessage,
  findHandoffsFrom,
  findReviewsOf,
  parseFindingsSource,
  parseHandoffSource,
  parseReviewSource,
} from "@t3tools/shared/handoff";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  CornerDownRightIcon,
  CornerLeftUpIcon,
  ScanSearchIcon,
  SendIcon,
} from "lucide-react";
import { memo, useMemo, useState } from "react";

import { newMessageId } from "../../lib/utils";
import { useThread, useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { agentLabel, reviewFindings } from "./handoff.logic";

interface LinkedThread {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly title: string;
  readonly worktreePath: string | null;
  readonly createdAt: string;
  readonly modelSelection: ModelSelection;
  readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
  readonly proposedPlans: ReadonlyArray<{ readonly planMarkdown: string }>;
  readonly session: { readonly status: string } | null;
  readonly latestTurn: { readonly state: string; readonly completedAt: string | null } | null;
}

const pillClass =
  "pointer-events-auto inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-xs backdrop-blur hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

function useAgentLabel(environmentId: EnvironmentId) {
  const { environments } = useEnvironments();
  const providers: ReadonlyArray<ServerProvider> =
    environments.find((item) => item.environmentId === environmentId)?.serverConfig?.providers ??
    [];
  return (selection: { instanceId: string; model: string }) => {
    const provider = providers.find((item) => item.instanceId === selection.instanceId);
    return provider ? agentLabel(provider, selection.model) : selection.model;
  };
}

/**
 * The ends of handoffs and reviews: a continuation links back to where it
 * came from, a review offers to send its findings back, and the original
 * lists who continued or reviewed it.
 */
export const HandoffLinks = memo(function HandoffLinks({ thread }: { thread: LinkedThread }) {
  const shells = useThreadShells();
  const labelFor = useAgentLabel(thread.environmentId);
  const firstUserText = thread.messages.find((message) => message.role === "user")?.text ?? null;
  const reviewSourceId = parseReviewSource(firstUserText);
  const sourceId = parseHandoffSource(firstUserText) ?? reviewSourceId;
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
  const reviews = useMemo(
    () => (reviewSourceId ? [] : findReviewsOf(thread, shells)),
    [reviewSourceId, shells, thread],
  );

  if (!source && continuations.length === 0 && reviews.length === 0) return null;
  return (
    <div className="mx-auto flex w-fit max-w-[min(48rem,calc(100%-2rem))] flex-wrap items-center justify-center gap-1.5 pt-2">
      {source ? (
        <Link
          className={pillClass}
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(source.environmentId, source.id))}
        >
          <CornerLeftUpIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {reviewSourceId ? "Review of" : "Continued from"} {source.title}
          </span>
        </Link>
      ) : null}
      {reviewSourceId && source ? <SendFindings review={thread} sourceId={source.id} /> : null}
      {continuations.map((next) => (
        <Link
          key={next.id}
          className={pillClass}
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(next.environmentId, next.id))}
        >
          <CornerDownRightIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            Continued with {labelFor(next.modelSelection)} ·{" "}
            {new Date(next.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        </Link>
      ))}
      {reviews.map((review) => (
        <Link
          key={review.id}
          className={pillClass}
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(review.environmentId, review.id))}
        >
          <ScanSearchIcon className="size-3.5 shrink-0" />
          <span className="truncate">Reviewed by {labelFor(review.modelSelection)}</span>
        </Link>
      ))}
    </div>
  );
});

/** On a finished review: send its findings to the original thread as a new turn. */
function SendFindings({ review, sourceId }: { review: LinkedThread; sourceId: ThreadId }) {
  const navigate = useNavigate();
  const sourceRef = scopeThreadRef(review.environmentId, sourceId);
  const source = useThread(sourceRef);
  const labelFor = useAgentLabel(review.environmentId);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [sending, setSending] = useState(false);

  const reviewRunning =
    review.session?.status === "running" ||
    (review.latestTurn !== null && review.latestTurn.completedAt === null);
  const findings = reviewFindings(review);
  const alreadySent = source?.messages.some(
    (message) => message.role === "user" && parseFindingsSource(message.text) === review.id,
  );
  const sourceRunning = source?.session?.status === "running";
  if (!source || reviewRunning || !findings) return null;
  if (alreadySent) {
    return (
      <Link
        className={pillClass}
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams(sourceRef)}
      >
        <CheckIcon className="size-3.5 shrink-0" />
        <span>Findings sent to {labelFor(source.modelSelection)}</span>
      </Link>
    );
  }

  async function send() {
    if (!source || sending) return;
    setSending(true);
    const result = await startTurn({
      environmentId: source.environmentId,
      input: {
        threadId: source.id,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: buildFindingsMessage({
            reviewThreadId: review.id,
            reviewerLabel: labelFor(review.modelSelection),
            findings,
          }),
          attachments: [],
        },
        runtimeMode: source.runtimeMode,
        // The original agent fixes things, so it leaves plan mode if it was in it.
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not send the findings",
          description: error instanceof Error ? error.message : "Try again from this thread.",
        });
      }
      return;
    }
    toastManager.add({
      type: "success",
      title: `Findings sent to ${labelFor(source.modelSelection)}`,
      description: source.title,
    });
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(sourceRef) });
  }

  return (
    <Button
      className="pointer-events-auto"
      size="compact"
      disabled={sending || sourceRunning}
      onClick={() => void send()}
    >
      <SendIcon />
      {sending
        ? "Sending…"
        : sourceRunning
          ? `${labelFor(source.modelSelection)} is still working`
          : `Send findings to ${labelFor(source.modelSelection)}`}
    </Button>
  );
}
