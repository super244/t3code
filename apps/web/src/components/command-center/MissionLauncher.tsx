/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { type ModelSelection } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { composerDraftHasUserContent, useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { MISSION_RECIPES, missionModelSelection, missionProviders } from "./missionLauncher.logic";

const selectClass =
  "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const projectKey = (environmentId: string, projectId: string) => `${environmentId}\0${projectId}`;

export function MissionLauncher({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const handleNewThread = useNewThreadHandler();
  const [requestedProjectKey, setRequestedProjectKey] = useState<string | null>(null);
  const [requestedSelection, setRequestedSelection] = useState<ModelSelection | null>(null);
  const [recipe, setRecipe] = useState<string>("custom");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const project =
    requestedProjectKey !== null
      ? projects.find((item) => projectKey(item.environmentId, item.id) === requestedProjectKey)
      : (projects.find((item) =>
          environments.some(
            (env) =>
              env.environmentId === item.environmentId && env.connection.phase === "connected",
          ),
        ) ?? projects[0]);
  const environment = environments.find((item) => item.environmentId === project?.environmentId);
  const providers = missionProviders(environment?.serverConfig?.providers ?? []);
  const selection = missionModelSelection(
    providers,
    requestedSelection ??
      project?.defaultModelSelection ??
      environment?.serverConfig?.settings.defaultModelSelection,
    requestedSelection !== null,
  );
  const provider = providers.find((item) => item.instanceId === selection?.instanceId);
  const connected = environment?.connection.phase === "connected";

  async function prepareMission() {
    if (!project || !selection || !connected || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        initializeDraft(draftId) {
          const store = useComposerDraftStore.getState();
          if (composerDraftHasUserContent(store.getComposerDraft(draftId))) {
            throw new Error(
              "This draft already contains work. Your prompt is still here; try again.",
            );
          }
          store.setModelSelection(draftId, selection, { explicit: true, replaceOptions: true });
          if (prompt.trim()) store.setPrompt(draftId, prompt.trim());
        },
      });
      if (!opened) throw new Error("The workspace changed while preparing the task. Try again.");
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare the task. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busyRef.current) onOpenChange(next);
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>New mission</DialogTitle>
          <DialogDescription>
            Choose where to work and which subscription to use. Review the draft before sending.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add a project from the sidebar to prepare a mission.
            </p>
          ) : (
            <>
              <label className="block space-y-1.5 text-xs text-muted-foreground">
                <span>Project / computer</span>
                <select
                  aria-label="Mission project"
                  className={selectClass}
                  disabled={busy}
                  value={project ? projectKey(project.environmentId, project.id) : ""}
                  onChange={(event) => {
                    setRequestedProjectKey(event.currentTarget.value);
                    setRequestedSelection(null);
                    setError(null);
                  }}
                >
                  {!project ? <option value="">Choose a project</option> : null}
                  {projects.map((item) => (
                    <option
                      key={projectKey(item.environmentId, item.id)}
                      value={projectKey(item.environmentId, item.id)}
                    >
                      {item.title} ·{" "}
                      {environments.find((env) => env.environmentId === item.environmentId)
                        ?.label ?? "Computer"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5 text-xs text-muted-foreground">
                  <span>Provider subscription</span>
                  <select
                    aria-label="Mission subscription"
                    className={selectClass}
                    disabled={busy || providers.length === 0}
                    value={selection?.instanceId ?? ""}
                    onChange={(event) => {
                      setRequestedSelection(
                        missionModelSelection(providers, {
                          instanceId: event.currentTarget.value as ModelSelection["instanceId"],
                          model: "",
                        }),
                      );
                      setError(null);
                    }}
                  >
                    {!selection && providers.length > 0 ? (
                      <option value="">Choose a subscription</option>
                    ) : null}
                    {providers.length === 0 ? (
                      <option value="">No ready providers</option>
                    ) : (
                      providers.map((item) => (
                        <option key={item.instanceId} value={item.instanceId}>
                          {item.displayName?.trim() || item.instanceId}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <label className="block space-y-1.5 text-xs text-muted-foreground">
                  <span>Model</span>
                  <select
                    aria-label="Mission model"
                    className={selectClass}
                    disabled={busy || !provider}
                    value={selection?.model ?? ""}
                    onChange={(event) => {
                      if (selection)
                        setRequestedSelection({ ...selection, model: event.currentTarget.value });
                    }}
                  >
                    {!provider ? (
                      <option value="">No model available</option>
                    ) : (
                      provider.models.map((item) => (
                        <option key={item.slug} value={item.slug}>
                          {item.shortName ?? item.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>
              <label className="block space-y-1.5 text-xs text-muted-foreground">
                <span>Task recipe</span>
                <select
                  aria-label="Mission recipe"
                  className={selectClass}
                  value={recipe}
                  disabled={busy}
                  onChange={(event) => {
                    const next = MISSION_RECIPES.find(
                      (item) => item.id === event.currentTarget.value,
                    );
                    if (next) {
                      setRecipe(next.id);
                      setPrompt(next.prompt);
                    }
                  }}
                >
                  {MISSION_RECIPES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5 text-xs text-muted-foreground">
                <span>Instructions</span>
                <Textarea
                  aria-label="Mission instructions"
                  placeholder="What would you like to accomplish?"
                  value={prompt}
                  disabled={busy}
                  rows={5}
                  onChange={(event) => setPrompt(event.currentTarget.value)}
                />
              </label>
              {!project ? (
                <p className="text-xs text-warning">
                  The selected project is no longer available. Choose a project.
                </p>
              ) : requestedSelection !== null && !selection ? (
                <p className="text-xs text-warning">
                  Your selected subscription or model is no longer ready. Choose a replacement.
                </p>
              ) : !connected ? (
                <p className="text-xs text-warning">
                  Connect this computer before preparing a mission.
                </p>
              ) : providers.length === 0 ? (
                <p className="text-xs text-warning">
                  Set up a ready provider in Settings → Providers.
                </p>
              ) : null}
            </>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={busy} />}>Cancel</DialogClose>
          <Button
            disabled={busy || !project || !selection || !connected}
            onClick={() => void prepareMission()}
          >
            {busy ? "Preparing…" : "Open draft"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
