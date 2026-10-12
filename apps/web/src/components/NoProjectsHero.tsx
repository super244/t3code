import { useAtomCommand } from "../state/use-atom-command";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { FolderOpenIcon, PlusIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { inferProjectTitleFromPath } from "../lib/projectPaths";
import { newProjectId } from "../lib/utils";
import { readLocalApi } from "../localApi";
import { useEnvironments } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";
import { stackedThreadToast, toastManager } from "./ui/toast";

export function NoProjectsHero() {
  const [isPicking, setIsPicking] = useState(false);
  const { environments } = useEnvironments();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const openNewThread = useNewThreadHandler();

  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);

  const handlePickFolder = useCallback(async () => {
    const api = readLocalApi();
    if (!api?.dialogs?.pickFolder) {
      openAddProject();
      return;
    }
    try {
      setIsPicking(true);
      const pickedPath = await api.dialogs.pickFolder();
      if (!pickedPath) {
        setIsPicking(false);
        return;
      }
      const primaryEnv = environments[0];
      if (!primaryEnv) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "No environment available",
            description: "Cannot create project without an active environment.",
          }),
        );
        setIsPicking(false);
        return;
      }
      const projectId = newProjectId();
      const result = await createProject({
        environmentId: primaryEnv.environmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(pickedPath),
          workspaceRoot: pickedPath,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: null,
        },
      });
      if (result._tag === "Failure") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to add project",
            description: "Could not create project from selected folder.",
          }),
        );
        setIsPicking(false);
        return;
      }
      await openNewThread(scopeProjectRef(primaryEnv.environmentId, projectId));
    } catch (cause) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not open folder picker",
          description: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      setIsPicking(false);
    }
  }, [createProject, environments, openAddProject, openNewThread]);

  const hasDesktopPicker = Boolean(readLocalApi()?.dialogs?.pickFolder);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <Empty className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-2xl sm:text-3xl">
                What should we work on?
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                Select a folder to start your first thread.
              </EmptyDescription>
              <div className="mt-6 flex flex-col items-center gap-3">
                {hasDesktopPicker ? (
                  <>
                    <Button
                      size="default"
                      onClick={() => void handlePickFolder()}
                      disabled={isPicking}
                      className="gap-2 px-5 py-2.5 text-sm shadow-sm"
                    >
                      <FolderOpenIcon className="size-4" />
                      {isPicking ? "Opening Finder…" : "Choose folder in Finder…"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={openAddProject}
                      className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <PlusIcon className="size-3.5" />
                      Type path or clone repository…
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={openAddProject}>
                    <PlusIcon className="size-4" />
                    Add project
                  </Button>
                )}
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
