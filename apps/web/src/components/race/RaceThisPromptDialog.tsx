/* agent-watermark: model=opus-5.5; effort=high; duration=55m; seat=claude-code; date=2026-10-19 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { createRaceId, parseRaceBranchName, RACE_MAX_SLOTS } from "@t3tools/shared/race";
import {
  guessRaceTaskKind,
  RACE_TASK_KIND_LABELS,
  recommendRaceEntrants,
} from "@t3tools/shared/raceHistory";
import type { ServerProvider } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  FlagIcon,
  GitBranchIcon,
  PlusIcon,
  SwordsIcon,
  TriangleAlertIcon,
  TrophyIcon,
  XIcon,
} from "lucide-react";
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
import { raceHistoryEnvironment } from "../../state/raceHistory";
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
import { raceEffortDescriptor, raceModelLabel, raceProviderLabel } from "./raceLabels";
import {
  defaultRaceEntrants,
  nextRaceEntrant,
  raceProviders,
  validateRaceDraft,
  type RaceEntrantDraft,
} from "./race.logic";
import { buildRaceStartTurns } from "./startRace";
import { RaceAutopilotFields, useRaceAutopilotDraft } from "./RaceAutopilotFields";

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
    () =>
      requestedEntrants ??
      (seed.rematch
        ? defaultRaceEntrants(providers, seed.sourceModel).slice(0, 1)
        : defaultRaceEntrants(providers, seed.sourceModel)),
    [providers, requestedEntrants, seed.sourceModel, seed.rematch],
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

  const rematch = seed.rematch ?? null;
  const maxEntrants = rematch
    ? Math.max(0, Math.min(DIALOG_MAX_ENTRANTS, RACE_MAX_SLOTS - rematch.existingCount))
    : DIALOG_MAX_ENTRANTS;
  // A rematch can send a single challenger: the defenders are already in the arena.
  const validation = rematch
    ? validateRematch({ entrants, providers, maxEntrants, connected, prompt })
    : validateRaceDraft({
        hasProject: project !== null,
        connected,
        isRepo,
        baseBranch,
        prompt,
        entrants,
        providers,
      });

  const taskKind = guessRaceTaskKind(prompt);
  const history = useEnvironmentQuery(
    raceHistoryEnvironment.list({ environmentId: seed.environmentId, input: {} }),
  );
  const recommendations = useMemo(
    () =>
      recommendRaceEntrants(
        history.data?.records ?? [],
        taskKind,
        providers.flatMap((provider) =>
          provider.models.map((model) => ({ driver: provider.driver, model: model.slug })),
        ),
        Math.max(1, Math.min(maxEntrants, DIALOG_MAX_ENTRANTS)),
      ),
    [history.data, taskKind, providers, maxEntrants],
  );
  const applyRecommended = () =>
    setRequestedEntrants(
      recommendations.flatMap(({ row }) => {
        const provider = providers.find(
          (item) =>
            item.driver === row.driver && item.models.some((model) => model.slug === row.model),
        );
        return provider
          ? [{ instanceId: provider.instanceId, model: row.model, effort: row.effort }]
          : [];
      }),
    );
  const recordRematch = useAtomCommand(raceHistoryEnvironment.record, { reportFailure: false });
  const autopilot = useRaceAutopilotDraft(providers);
  const [starting, setStarting] = useState(false);
  const busyRef = useRef(false);

  const updateEntrant = (index: number, next: RaceEntrantDraft) =>
    setRequestedEntrants(entrants.map((entrant, i) => (i === index ? next : entrant)));

  async function start() {
    if (!project || !validation.ok || busyRef.current) return;
    busyRef.current = true;
    setStarting(true);
    const raceId = rematch?.raceId ?? createRaceId();
    try {
      const turns = buildRaceStartTurns({
        environmentId: project.environmentId,
        projectId: project.id,
        projectCwd: project.workspaceRoot,
        // A rematch starts from the commit the race began on, not today's branch tip.
        baseBranch: rematch?.baseCommit ?? baseBranch,
        prompt,
        raceId,
        entrants: entrants.map((entrant) => ({
          provider: providers.find((item) => item.instanceId === entrant.instanceId)!,
          model: entrant.model,
          effort: entrant.effort ?? null,
        })),
        createdAt: new Date().toISOString(),
        newThreadId,
        newMessageId,
        ...(rematch ? { append: { existingCount: rematch.existingCount } } : {}),
      });
      const results = await Promise.all(turns.map((turn) => startTurn(turn)));
      if (rematch && results.some((result) => result._tag === "Success")) {
        const newSlots = turns.flatMap((turn, index) => {
          const identity = parseRaceBranchName(turn.input.bootstrap.prepareWorktree.branch);
          return results[index]?._tag === "Success" && identity ? [identity.slot] : [];
        });
        // The new heat goes into the history as soon as it starts, so the arena
        // knows which heat a judge or a Keep decides.
        await recordRematch({
          environmentId: project.environmentId,
          input: {
            raceId: rematch.raceId,
            projectId: project.id,
            projectTitle: rematch.projectTitle,
            titleSeed: rematch.titleSeed,
            prompt,
            taskKind,
            taskKindSource: "guessed",
            startedAt: rematch.startedAt,
            outcome: "open",
            keptSlot: null,
            judge: null,
            entrants: [],
            heat: rematch.heat,
            heatStartedAt: new Date().toISOString(),
            participants: [...rematch.liveSlots, ...newSlots],
            baseCommit: rematch.baseCommit,
          },
        });
      }
      const failures = results.filter((result) => result._tag === "Failure");
      if (failures.length < results.length) {
        await autopilot.arm({
          environmentId: project.environmentId,
          raceId,
          heat: rematch?.heat ?? 1,
        });
      }
      if (failures.length === results.length) {
        const error = squashAtomCommandFailure(failures[0]!);
        toastManager.add({
          type: "error",
          title: rematch ? "The rematch could not start" : "The race could not start",
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
  const canAdd = entrants.length < maxEntrants && providers.length > 0;
  const minEntrants = rematch ? 1 : 2;

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
          {rematch ? (
            <>
              <SwordsIcon className="size-4 text-muted-foreground" /> Rematch
            </>
          ) : (
            <>
              <FlagIcon className="size-4 text-muted-foreground" /> Race this prompt
            </>
          )}
        </DialogTitle>
        <DialogDescription>
          {rematch
            ? `New challengers race the ${rematch.liveSlots.length === 1 ? "entrant" : `${rematch.liveSlots.length} entrants`} still in the arena on the same prompt, from the commit the race began on. The result is recorded as rematch ${rematch.heat - 1}.`
            : "Each agent gets the same prompt in its own worktree. You compare them side by side in the arena and keep the best."}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          Prompt
          <Textarea
            aria-label="Prompt to race"
            value={prompt}
            readOnly={rematch !== null}
            onChange={(event) => setEditedPrompt(event.target.value)}
            placeholder={
              seed.sourceThreadId && !sourceThread
                ? "Loading the thread's last request…"
                : "Describe the task every agent should attempt…"
            }
            className="min-h-24 text-sm text-foreground"
          />
        </label>

        {recommendations.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-amber-500/25 bg-amber-500/6 px-3 py-2.5">
            <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <TrophyIcon className="size-3.5 text-amber-600 dark:text-amber-300" />
                Ladder picks for {RACE_TASK_KIND_LABELS[taskKind].toLowerCase()} tasks
                {recommendations[0]?.scope === "overall" ? (
                  <span className="font-normal text-muted-foreground">
                    (no {RACE_TASK_KIND_LABELS[taskKind].toLowerCase()} races yet — overall ratings)
                  </span>
                ) : null}
              </span>
              <Button type="button" size="xs" variant="outline" onClick={applyRecommended}>
                Use these
              </Button>
            </div>
            <ul className="flex min-w-0 flex-wrap gap-1.5">
              {recommendations.map(({ row }) => (
                <li
                  key={row.key}
                  className="inline-flex items-center gap-1.5 rounded-md bg-background/70 px-2 py-0.5 text-[11px]"
                >
                  <span className="font-medium">{row.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {row.rating} ±{row.spread} · {row.wins}–{row.losses}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>{rematch ? "Challengers" : "Agents"}</span>
            <span className="tabular-nums">
              {entrants.length} of {maxEntrants}
            </span>
          </div>
          {entrants.map((entrant, index) => {
            const provider = providers.find((item) => item.instanceId === entrant.instanceId);
            return (
              <div
                key={`slot-${index + 1}`}
                className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2 sm:grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)_6.5rem_2rem]"
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
                  onChange={(model) => updateEntrant(index, { ...entrant, model, effort: null })}
                />
                <EffortSelect
                  index={index}
                  provider={provider}
                  entrant={entrant}
                  disabled={starting}
                  onChange={(effort) => updateEntrant(index, { ...entrant, effort })}
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove agent ${index + 1}`}
                  disabled={starting || entrants.length <= minEntrants}
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

        <RaceAutopilotFields
          draft={autopilot.draft}
          onChange={autopilot.setDraft}
          providers={providers}
          disabled={starting}
        />

        <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2.5 text-xs">
          <span className="flex min-w-0 items-center gap-1.5">
            <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {project?.title ?? "Unknown project"} · starts from{" "}
              {rematch ? (
                <>
                  <span className="font-mono">{rematch.baseCommit.slice(0, 10)}</span>, the commit
                  the race began on
                </>
              ) : (
                <span className="font-mono">{baseBranch || "…"}</span>
              )}
            </span>
          </span>
          {uncommitted > 0 && !rematch ? (
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
          {validation.ok
            ? rematch
              ? `${entrants.length} ${entrants.length === 1 ? "challenger" : "challengers"} against ${rematch.liveSlots.length} in the arena.`
              : `${entrants.length} agents, one prompt.`
            : validation.reason}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="ghost" onClick={closeRaceDialog}>
            Cancel
          </Button>
          <Button type="submit" disabled={!validation.ok || starting}>
            {rematch ? <SwordsIcon /> : <FlagIcon />}{" "}
            {starting
              ? "Starting…"
              : rematch
                ? `Start rematch · ${entrants.length}`
                : `Start race · ${entrants.length}`}
            <Kbd className="ms-1 max-sm:hidden">⌘↵</Kbd>
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function validateRematch(input: {
  readonly entrants: ReadonlyArray<RaceEntrantDraft>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly maxEntrants: number;
  readonly connected: boolean;
  readonly prompt: string;
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (!input.connected) return { ok: false, reason: "Connect this computer to start a rematch." };
  if (input.maxEntrants === 0) {
    return { ok: false, reason: `This race has used all ${RACE_MAX_SLOTS} entrant slots.` };
  }
  if (input.prompt.trim().length === 0) return { ok: false, reason: "The race has no prompt." };
  if (input.entrants.length < 1) return { ok: false, reason: "Add a challenger." };
  if (input.entrants.length > input.maxEntrants) {
    return { ok: false, reason: `At most ${input.maxEntrants} challengers fit in this race.` };
  }
  for (const [index, entrant] of input.entrants.entries()) {
    const provider = input.providers.find((item) => item.instanceId === entrant.instanceId);
    if (!provider)
      return { ok: false, reason: `Challenger ${index + 1}: choose a ready provider.` };
    if (!provider.models.some((model) => model.slug === entrant.model)) {
      return { ok: false, reason: `Challenger ${index + 1}: choose a model.` };
    }
  }
  return { ok: true };
}

/** The model's reasoning effort, when it has one: the same model at another effort is its own entrant. */
function EffortSelect({
  index,
  provider,
  entrant,
  disabled,
  onChange,
}: {
  index: number;
  provider: ServerProvider | undefined;
  entrant: RaceEntrantDraft;
  disabled: boolean;
  onChange: (effort: string | null) => void;
}) {
  const descriptor = raceEffortDescriptor(provider, entrant.model);
  if (!descriptor) {
    return (
      <span className="hidden text-center text-[11px] text-muted-foreground/70 sm:block">
        no effort
      </span>
    );
  }
  const fallback =
    descriptor.currentValue ??
    descriptor.options.find((choice) => choice.isDefault)?.id ??
    descriptor.options[0]?.id ??
    "";
  return (
    <div className="col-span-2 col-start-2 sm:col-span-1 sm:col-start-auto">
      <RaceSelect
        ariaLabel={`Agent ${index + 1} effort`}
        value={entrant.effort ?? fallback}
        disabled={disabled}
        options={descriptor.options.map((choice) => ({ value: choice.id, label: choice.label }))}
        onChange={(value) => onChange(value === fallback ? null : value)}
      />
    </div>
  );
}
