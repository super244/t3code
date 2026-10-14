/* agent-watermark: model=haiku-5.5; effort=high; duration=65m; seat=claude-code; date=2026-10-13 */
/* agent-watermark: model=opus-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-12 */
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { MessageSquareOffIcon } from "lucide-react";
import { useCallback, useEffect } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { resolveThreadRouteRef, resolveThreadRouteRenderState } from "../threadRoutes";
import { resolveThreadSyncPhase } from "../threadSync";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { SidebarInset } from "~/components/ui/sidebar";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { useEnvironments } from "../state/environments";
import {
  useEnvironmentThreadRefs,
  useThreadDetail,
  useThreadShell,
  useThreadStatus,
} from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const navigateWithinThreadRoute = useNavigate({ from: Route.fullPath });
  const clearFocusMessageRequest = useCallback(() => {
    void navigateWithinThreadRoute({
      search: (previous) => {
        const { message: _message, ...rest } = previous;
        return rest;
      },
      replace: true,
      resetScroll: false,
    });
  }, [navigateWithinThreadRoute]);
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const shell = useEnvironmentQuery(
    threadRef === null ? null : environmentShell.stateAtom(threadRef.environmentId),
  );
  const serverThreadShell = useThreadShell(threadRef);
  const serverThreadDetail = useThreadDetail(threadRef);
  const serverThreadStatus = useThreadStatus(threadRef);
  const environmentThreadRefs = useEnvironmentThreadRefs(threadRef?.environmentId ?? null);
  const bootstrapComplete = shell.data?.snapshot._tag === "Some";
  const environmentHasServerThreads = environmentThreadRefs.length > 0;
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadShellExists: serverThreadShell !== null,
    serverThreadDetailExists: serverThreadDetail !== null,
    serverThreadDetailDeleted: serverThreadStatus === "deleted",
    draftThreadExists,
  });
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverThreadDetail !== null,
    shellExists: serverThreadShell !== null,
    status: serverThreadStatus,
  });
  const serverThreadStarted = threadHasStarted(serverThreadDetail);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const { environments } = useEnvironments();
  // An address whose environment this client does not know (a mistyped
  // /settings/archive lands here as environment "settings") never bootstraps, so
  // it used to render an empty pane forever.
  const environmentUnknown =
    threadRef !== null &&
    environments.length > 0 &&
    !environments.some((environment) => environment.environmentId === threadRef.environmentId);

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    // Navigation already resolved onto this path, so a drop aimed here
    // passed its landing check; once the thread reads as missing it can
    // never be attached, release it even when there is nowhere to redirect.
    if (renderState === "missing") {
      const { clearPendingFileDropsForThread } = useSidebarPendingFileDropStore.getState();
      clearPendingFileDropsForThread(threadRef);
      if (environmentHasAnyThreads) {
        void navigate({ to: "/", replace: true });
      }
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, renderState, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread, serverThreadStarted, threadRef]);

  if (!threadRef) {
    return null;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      {renderState === "ready" || (renderState === "loading" && serverThreadShell !== null) ? (
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          routeKind="server"
          threadSyncPhase={threadSyncPhase}
          onFocusMessageHandled={clearFocusMessageRequest}
        />
      ) : environmentUnknown || (renderState === "missing" && !environmentHasAnyThreads) ? (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareOffIcon />
            </EmptyMedia>
            <EmptyTitle>Thread not found</EmptyTitle>
            <EmptyDescription>
              {environmentUnknown
                ? "This address does not point at a computer or thread this app knows."
                : "This thread was deleted or never synced to this computer."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" render={<Link to="/" />}>
              Back to threads
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}
    </SidebarInset>
  );
}

const MAX_FOCUS_MESSAGE_ID_LENGTH = 512;

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  // `message` names a message to scroll to and flash, set by thread search.
  validateSearch: (raw: Record<string, unknown>): { readonly message?: string } =>
    typeof raw.message === "string" &&
    raw.message.length > 0 &&
    raw.message.length <= MAX_FOCUS_MESSAGE_ID_LENGTH
      ? { message: raw.message }
      : {},
  component: ChatThreadRouteView,
});
