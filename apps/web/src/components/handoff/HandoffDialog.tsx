/* agent-watermark: model=opus-5.5; effort=high; duration=60m; seat=claude-code; date=2026-10-05 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { type ModelSelection } from "@t3tools/contracts";
import { buildHandoffBrief, buildHandoffTitle } from "@t3tools/shared/handoff";
import { truncate } from "@t3tools/shared/String";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightLeftIcon, SquareIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  closeHandoffDialog,
  readHandoffDialogState,
  subscribeHandoffDialog,
} from "../../handoffDialog";
import { newMessageId, newThreadId } from "../../lib/utils";
import { useProjects, useThread, waitForThreadShell } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { buildThreadRouteParams } from "../../threadRoutes";
import { buildThreadTurnInterruptInput } from "../ChatView.logic";
import { getTriggerDisplayModelLabel, PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  agentLabel,
  defaultHandoffTarget,
  providerLabel,
  handoffMessages,
  handoffProviders,
  retargetHandoff,
  validateHandoff,
  type HandoffTarget,
} from "./handoff.logic";

const selectClass =
  "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-64";

/** Rendered once in the root route; opened through `openHandoffDialog`. */
export function HandoffDialogHost() {
  const state = useSyncExternalStore(
    subscribeHandoffDialog,
    readHandoffDialogState,
    readHandoffDialogState,
  );
  return (
    <Dialog
      open={state.threadRef !== null}
      onOpenChange={(open) => {
        if (!open) closeHandoffDialog();
      }}
    >
      <DialogPopup className="max-w-xl">
        {state.threadRef ? (
          <HandoffForm
            key={`${state.threadRef.environmentId}:${state.threadRef.threadId}`}
            reason={state.reason}
            threadRef={state.threadRef}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function HandoffForm({
  threadRef,
  reason,
}: {
  threadRef: NonNullable<ReturnType<typeof readHandoffDialogState>["threadRef"]>;
  reason: string | null;
}) {
  const navigate = useNavigate();
  const thread = useThread(threadRef);
  const projects = useProjects();
  const { environments } = useEnvironments();
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const [requestedTarget, setRequestedTarget] = useState<HandoffTarget | null>(null);
  const [note, setNote] = useState("");
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const busyRef = useRef(false);

  const environment = environments.find((item) => item.environmentId === threadRef.environmentId);
  const allProviders = environment?.serverConfig?.providers;
  const providers = useMemo(() => handoffProviders(allProviders ?? []), [allProviders]);
  const project = thread
    ? projects.find(
        (item) => item.environmentId === thread.environmentId && item.id === thread.projectId,
      )
    : undefined;
  const cwd = thread?.worktreePath ?? project?.workspaceRoot ?? null;
  const status = useEnvironmentQuery(
    cwd ? vcsEnvironment.status({ environmentId: threadRef.environmentId, input: { cwd } }) : null,
  );

  const sourceProvider = providers.find(
    (item) => item.instanceId === thread?.modelSelection.instanceId,
  );
  const sourceAgentLabel = thread
    ? sourceProvider
      ? agentLabel(sourceProvider, thread.modelSelection.model)
      : `${thread.modelSelection.instanceId} · ${thread.modelSelection.model}`
    : "";
  const target =
    requestedTarget ?? (thread ? defaultHandoffTarget(providers, thread.modelSelection) : null);
  const targetProvider = providers.find((item) => item.instanceId === target?.instanceId);
  const targetLabel =
    targetProvider && target ? agentLabel(targetProvider, target.model) : "the new agent";
  const TargetIcon = targetProvider ? PROVIDER_ICON_BY_PROVIDER[targetProvider.driver] : undefined;

  const messages = useMemo(() => handoffMessages(thread?.messages ?? []), [thread?.messages]);
  const latestPlan = thread?.proposedPlans.at(-1)?.planMarkdown ?? null;
  const changedFiles = status.data?.workingTree.files ?? null;
  const lastError = thread?.session?.lastError ?? reason;
  const sourceRunning = thread?.session?.status === "running";

  const brief = useMemo(
    () =>
      thread
        ? buildHandoffBrief({
            sourceThreadId: thread.id,
            sourceTitle: thread.title,
            sourceAgentLabel,
            messages,
            latestPlan,
            changedFiles,
            branch: thread.branch,
            worktreePath: thread.worktreePath,
            lastError,
            note,
          })
        : "",
    [thread, sourceAgentLabel, messages, latestPlan, changedFiles, lastError, note],
  );

  const validation = validateHandoff({
    target,
    providers,
    sourceRunning,
    hasMessages: messages.length > 0,
  });

  // Reset the busy guard when the dialog unmounts mid-request.
  useEffect(
    () => () => {
      busyRef.current = false;
    },
    [],
  );

  async function stopSource() {
    if (!thread || stopping) return;
    setStopping(true);
    const result = await interruptTurn({
      environmentId: thread.environmentId,
      input: buildThreadTurnInterruptInput(thread),
    });
    setStopping(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not stop the current agent",
        description: error instanceof Error ? error.message : "Try stopping it from the thread.",
      });
    }
  }

  async function startHandoff() {
    if (!thread || !target || !validation.ok || busyRef.current) return;
    busyRef.current = true;
    setStarting(true);
    const createdAt = new Date().toISOString();
    const threadId = newThreadId();
    const modelSelection: ModelSelection = { instanceId: target.instanceId, model: target.model };
    const title = buildHandoffTitle(thread.title);
    try {
      const result = await startTurn({
        environmentId: thread.environmentId,
        input: {
          threadId,
          message: { messageId: newMessageId(), role: "user", text: brief, attachments: [] },
          modelSelection,
          // A seed that differs from the title keeps "↪ <title>" instead of a
          // generated one; the prefix is what links the two threads.
          titleSeed: truncate(thread.title),
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          bootstrap: {
            createThread: {
              projectId: thread.projectId,
              title,
              modelSelection,
              runtimeMode: thread.runtimeMode,
              interactionMode: thread.interactionMode,
              // Same branch and checkout: the new agent picks up the files as they are.
              branch: thread.branch,
              worktreePath: thread.worktreePath,
              createdAt,
            },
          },
          createdAt,
        },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "The handoff could not start",
            description: error instanceof Error ? error.message : "The new thread failed to start.",
          });
        }
        return;
      }
      const newRef = scopeThreadRef(thread.environmentId, threadId);
      // Opening the route before the thread reaches the client reads as
      // "missing" and bounces to a new draft.
      await waitForThreadShell(newRef).catch(() => null);
      closeHandoffDialog();
      toastManager.add({
        type: "success",
        title: `Continuing with ${targetLabel}`,
        description: thread.title,
      });
      void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(newRef) });
    } finally {
      busyRef.current = false;
      setStarting(false);
    }
  }

  if (!thread) {
    return (
      <DialogHeader>
        <DialogTitle>Continue with another agent</DialogTitle>
        <DialogDescription>Loading the thread…</DialogDescription>
      </DialogHeader>
    );
  }

  const fileCount = changedFiles?.length ?? 0;

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        void startHandoff();
      }}
    >
      <DialogHeader>
        <DialogTitle>Continue with another agent</DialogTitle>
        <DialogDescription>
          A new thread picks up “{thread.title}” in the same checkout, with a brief of the
          conversation so far. This thread stays as it is.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-4">
        {reason ? (
          <p className="rounded-md border border-warning/40 bg-warning/8 px-3 py-2 text-xs text-warning-foreground">
            {sourceAgentLabel} stopped: {reason}
          </p>
        ) : null}
        <div className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {TargetIcon ? (
              <TargetIcon className="size-4" />
            ) : (
              <ArrowRightLeftIcon className="size-4" />
            )}
          </span>
          <select
            aria-label="Agent to continue with"
            className={selectClass}
            value={target?.instanceId ?? ""}
            disabled={starting || providers.length === 0}
            onChange={(event) =>
              setRequestedTarget(retargetHandoff(providers, event.currentTarget.value))
            }
          >
            {providers.length === 0 ? <option value="">No ready providers</option> : null}
            {providers.map((item) => (
              <option key={item.instanceId} value={item.instanceId}>
                {providerLabel(item)}
                {item.instanceId === thread.modelSelection.instanceId ? " (current)" : ""}
              </option>
            ))}
          </select>
          <select
            aria-label="Model"
            className={selectClass}
            value={target?.model ?? ""}
            disabled={starting || !targetProvider}
            onChange={(event) =>
              target && setRequestedTarget({ ...target, model: event.currentTarget.value })
            }
          >
            {targetProvider?.models.map((model) => (
              <option key={model.slug} value={model.slug}>
                {getTriggerDisplayModelLabel(model)}
              </option>
            ))}
          </select>
        </div>
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          <span>What should it do next? (optional)</span>
          <Textarea
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void startHandoff();
              }
            }}
            value={note}
            disabled={starting}
            placeholder="Finish the original request and tell me what changed."
            rows={2}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </label>
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md bg-muted/60 px-2.5 py-2">
            <dt className="text-muted-foreground">Messages</dt>
            <dd className="font-medium tabular-nums">{messages.length}</dd>
          </div>
          <div className="rounded-md bg-muted/60 px-2.5 py-2">
            <dt className="text-muted-foreground">Changed files</dt>
            <dd className="font-medium tabular-nums">
              {/* Status is a live stream, so "waiting" stays true; data is the signal. */}
              {status.data === null && cwd && !status.error ? "…" : fileCount}
            </dd>
          </div>
          <div className="min-w-0 rounded-md bg-muted/60 px-2.5 py-2">
            <dt className="text-muted-foreground">Checkout</dt>
            <dd className="truncate font-medium">
              {thread.branch ?? (thread.worktreePath ? "worktree" : "project folder")}
            </dd>
          </div>
        </dl>
        <details className="group rounded-md border border-border/70">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground select-none">
            Preview the brief ({brief.length.toLocaleString()} characters)
          </summary>
          <pre className="max-h-64 overflow-auto border-t border-border/70 px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap">
            {brief}
          </pre>
        </details>
      </DialogPanel>
      <DialogFooter className="items-center sm:justify-between">
        <p
          className="min-w-0 flex-1 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {validation.ok ? `${sourceAgentLabel} → ${targetLabel}` : validation.reason}
        </p>
        <div className="flex shrink-0 gap-2">
          {sourceRunning ? (
            <Button
              type="button"
              variant="outline"
              disabled={stopping}
              onClick={() => void stopSource()}
            >
              <SquareIcon />
              {stopping ? "Stopping…" : "Stop current agent"}
            </Button>
          ) : null}
          <Button type="submit" disabled={starting || !validation.ok}>
            <ArrowRightLeftIcon />
            {starting ? "Starting…" : "Continue"}
            <Kbd className="ms-1 max-sm:hidden">⌘↵</Kbd>
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
