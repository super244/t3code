/* agent-watermark: model=opus-5.5; effort=high; duration=35m; seat=claude-code; date=2026-10-19 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { createRaceId } from "@t3tools/shared/race";
import { useNavigate } from "@tanstack/react-router";
import { FlagIcon, GitBranchIcon, PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";

import { newMessageId, newThreadId } from "../../lib/utils";
import {
  closeRaceDialog,
  readRaceDialogState,
  subscribeRaceDialog,
  type RaceDialogSeed,
} from "../../raceDialog";
import { useProjects, useThread } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Kbd } from "../ui/kbd";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { RaceSelect } from "./RaceComposer";
import { raceModelLabel, raceProviderLabel } from "./raceLabels";
import {
  defaultRaceEntrants,
  nextRaceEntrant,
  raceProviders,
  validateRaceDraft,
  type RaceEntrantDraft,
} from "./race.logic";
import { buildRaceStartTurns } from "./startRace";

/** "Race this prompt" stays compact: two or three agents, picked in a few clicks. */
const DIALOG_MAX_ENTRANTS = 3;

/** Rendered once in the root route; opened through `openRaceDialogForThread`. */
export function RaceThisPromptDialogHost() {
  const seed = useSyncExternalStore(subscribeRaceDialog, readRaceDialogState, readRaceDialogState);
  return (
    <Dialog
      open={seed !== null}
      onOpenChange={(open) => {
        if (!open) closeRaceDialog();
      }}
    >
      <DialogPopup className="max-w-xl">
        {seed ? (
          <RaceThisPromptForm
            key={`${seed.environmentId}:${seed.projectId}:${seed.sourceThreadId ?? "draft"}`}
            seed={seed}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function RaceThisPromptForm({ seed }: { seed: RaceDialogSeed }) {
  const navigate = useNavigate();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const sourceThread = useThread(
    seed.sourceThreadId ? scopeThreadRef(seed.environmentId, seed.sourceThreadId) : null,
  );
  const project =
    projects.find(
      (item) => item.environmentId === seed.environmentId && item.id === seed.projectId,
    ) ?? null;
  const environment = environments.find((item) => item.environmentId === seed.environmentId);
  const connected = environment?.connection.phase === "connected";
  const allProviders = environment?.serverConfig?.providers;
  const providers = useMemo(() => raceProviders(allProviders ?? []), [allProviders]);

  const lastRequest =
    sourceThread?.messages.toReversed().find((message) => message.role === "user")?.text ?? null;
  const [editedPrompt, setEditedPrompt] = useState<string | null>(null);
  const prompt = editedPrompt ?? seed.prompt ?? lastRequest ?? "";

  const [requestedEntrants, setRequestedEntrants] = useState<RaceEntrantDraft[] | null>(null);
  const entrants = useMemo(
    () => requestedEntrants ?? defaultRaceEntrants(providers, seed.sourceModel),
    [providers, requestedEntrants, seed.sourceModel],
  );

  const checkoutStatus = useEnvironmentQuery(
    project && connected
      ? vcsEnvironment.status({
          environmentId: seed.environmentId,
          input: { cwd: seed.checkoutCwd ?? project.workspaceRoot },
        })
      : null,
  );
  const baseBranch = seed.baseBranch ?? checkoutStatus.data?.refName ?? "";
  const uncommitted = checkoutStatus.data?.workingTree?.files.length ?? 0;
  const isRepo = checkoutStatus.data?.isRepo ?? null;

  const validation = validateRaceDraft({
    hasProject: project !== null,
    connected,
    isRepo,
    baseBranch,
    prompt,
    entrants,
    providers,
  });
  const [starting, setStarting] = useState(false);
  const busyRef = useRef(false);

  const updateEntrant = (index: number, next: RaceEntrantDraft) =>
    setRequestedEntrants(entrants.map((entrant, i) => (i === index ? next : entrant)));

  async function start() {
    if (!project || !validation.ok || busyRef.current) return;
    busyRef.current = true;
    setStarting(true);
    const raceId = createRaceId();
    try {
      const results = await Promise.all(
        buildRaceStartTurns({
          environmentId: project.environmentId,
          projectId: project.id,
          projectCwd: project.workspaceRoot,
          baseBranch,
          prompt,
          raceId,
          entrants: entrants.map((entrant) => ({
            provider: providers.find((item) => item.instanceId === entrant.instanceId)!,
            model: entrant.model,
          })),
          createdAt: new Date().toISOString(),
          newThreadId,
          newMessageId,
        }).map((turn) => startTurn(turn)),
      );
      const failures = results.filter((result) => result._tag === "Failure");
      if (failures.length === results.length) {
        const error = squashAtomCommandFailure(failures[0]!);
        toastManager.add({
          type: "error",
          title: "The race could not start",
          description: error instanceof Error ? error.message : "No entrant started.",
        });
        return;
      }
      if (failures.length > 0) {
        toastManager.add({
          type: "warning",
          title: `${results.length - failures.length} of ${results.length} entrants started`,
          description: "The arena shows the ones that did.",
        });
      }
      closeRaceDialog();
      void navigate({ to: "/race", search: { race: raceId, env: project.environmentId } });
    } finally {
      busyRef.current = false;
      setStarting(false);
    }
  }

  const providerOptions = providers.map((provider) => {
    const Icon = PROVIDER_ICON_BY_PROVIDER[provider.driver];
    return {
      value: provider.instanceId,
      label: raceProviderLabel(provider),
      icon: Icon ? <Icon className="size-3.5" /> : undefined,
    };
  });
  const canAdd = entrants.length < DIALOG_MAX_ENTRANTS && providers.length > 0;

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void start();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FlagIcon className="size-4 text-muted-foreground" /> Race this prompt
        </DialogTitle>
        <DialogDescription>
          Each agent gets the same prompt in its own worktree. You compare them side by side in the
          arena and keep the best.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Prompt
          <Textarea
            aria-label="Prompt to race"
            value={prompt}
            onChange={(event) => setEditedPrompt(event.target.value)}
            placeholder={
              seed.sourceThreadId && !sourceThread
                ? "Loading the thread's last request…"
                : "Describe the task every agent should attempt…"
            }
            className="min-h-24 text-sm text-foreground"
          />
        </label>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Agents</span>
            <span className="tabular-nums">
              {entrants.length} of {DIALOG_MAX_ENTRANTS}
            </span>
          </div>
          {entrants.map((entrant, index) => {
            const provider = providers.find((item) => item.instanceId === entrant.instanceId);
            return (
              <div
                key={`slot-${index + 1}`}
                className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2"
              >
                <span className="text-center text-xs font-medium text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <RaceSelect
                  ariaLabel={`Agent ${index + 1} provider`}
                  value={entrant.instanceId}
                  options={providerOptions}
                  disabled={starting}
                  onChange={(instanceId) => {
                    const next = providers.find((item) => item.instanceId === instanceId);
                    const model =
                      (next?.models.find((item) => item.isDefault) ?? next?.models[0])?.slug ?? "";
                    updateEntrant(index, { instanceId, model });
                  }}
                />
                <RaceSelect
                  ariaLabel={`Agent ${index + 1} model`}
                  value={entrant.model}
                  disabled={starting || !provider}
                  options={(provider?.models ?? []).map((model) => ({
                    value: model.slug,
                    label: raceModelLabel(provider, model.slug),
                  }))}
                  onChange={(model) => updateEntrant(index, { ...entrant, model })}
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove agent ${index + 1}`}
                  disabled={starting || entrants.length <= 2}
                  onClick={() => setRequestedEntrants(entrants.filter((_, i) => i !== index))}
                >
                  <XIcon />
                </Button>
              </div>
            );
          })}
          {canAdd ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start text-muted-foreground"
              disabled={starting}
              onClick={() => {
                const next = nextRaceEntrant(providers, entrants);
                if (next) setRequestedEntrants([...entrants, next]);
              }}
            >
              <PlusIcon /> Add an agent
            </Button>
          ) : null}
          {providers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No agent on this computer is ready. Sign in to one under Settings → Providers.
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2.5 text-xs">
          <span className="flex min-w-0 items-center gap-1.5">
            <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {project?.title ?? "Unknown project"} · starts from{" "}
              <span className="font-mono">{baseBranch || "…"}</span>
            </span>
          </span>
          {uncommitted > 0 ? (
            <span className="flex items-start gap-1.5 text-warning-foreground">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This checkout has {uncommitted} uncommitted{" "}
                {uncommitted === 1 ? "change" : "changes"}. Entrants start from{" "}
                <span className="font-mono">{baseBranch}</span> as committed, without them.
              </span>
            </span>
          ) : null}
        </div>
      </DialogPanel>
      <DialogFooter className="items-center sm:justify-between">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground" aria-live="polite">
          {validation.ok ? `${entrants.length} agents, one prompt.` : validation.reason}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="ghost" onClick={closeRaceDialog}>
            Cancel
          </Button>
          <Button type="submit" disabled={!validation.ok || starting}>
            <FlagIcon /> {starting ? "Starting…" : `Start race · ${entrants.length}`}
            <Kbd className="ms-1 max-sm:hidden">⌘↵</Kbd>
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
