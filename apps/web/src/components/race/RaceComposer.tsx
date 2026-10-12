/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=10m; seat=antigravity; date=2026-10-10 */
/* agent-watermark: model=opus-5.5; effort=high; duration=85m; seat=claude-code; date=2026-10-04 */
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { buildRaceBranchName, createRaceId, RACE_MAX_ENTRANTS } from "@t3tools/shared/race";
import { truncate } from "@t3tools/shared/String";
import { FlagIcon, PlusIcon, XIcon } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";

import { newMessageId, newThreadId } from "../../lib/utils";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { getTriggerDisplayModelLabel, PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  buildRaceEntrantTitle,
  defaultRaceEntrants,
  groupRaces,
  nextRaceEntrant,
  raceProjectLabels,
  raceProviders,
  validateRaceDraft,
  type RaceEntrantDraft,
} from "./race.logic";

interface RaceSelectOption {
  readonly value: string;
  readonly label: string;
  readonly icon?: ReactNode | undefined;
}

/** The app's own select (popup, keyboard, theming), in the shape the Race form needs. */
function RaceSelect({
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
}: {
  readonly ariaLabel: string;
  readonly value: string;
  readonly options: readonly RaceSelectOption[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
}) {
  return (
    <Select
      modal={false}
      value={value}
      disabled={disabled}
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      onValueChange={(next: string | null) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <SelectTrigger aria-label={ariaLabel} className="w-full min-w-0">
        {options.find((option) => option.value === value)?.icon}
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {option.icon}
              <span className="truncate">{option.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
const projectKey = (environmentId: string, projectId: string) => `${environmentId}\0${projectId}`;

// Session memory for the project picker: the page unmounts on navigation, so
// component state alone would fall back to the first project every visit.
const rememberedProjectKeyByEnvironment = new Map<string, string>();
let rememberedEnvironmentId: string | null = null;
function rememberProject(key: string) {
  const environmentId = key.slice(0, key.indexOf("\0"));
  rememberedProjectKeyByEnvironment.set(environmentId, key);
  rememberedEnvironmentId = environmentId;
}

export function raceProviderLabel(
  provider: Pick<ServerProvider, "displayName" | "instanceId">,
): string {
  return provider.displayName?.trim() || provider.instanceId;
}

export function raceModelLabel(provider: ServerProvider | undefined, slug: string): string {
  const model = provider?.models.find((item) => item.slug === slug);
  return model ? getTriggerDisplayModelLabel(model) : slug;
}

export function RaceComposer() {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const threads = useThreadShells();
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [requestedProjectKey, setRequestedProjectKey] = useState<string | null>(() =>
    rememberedEnvironmentId === null
      ? null
      : (rememberedProjectKeyByEnvironment.get(rememberedEnvironmentId) ?? null),
  );
  const [requestedBaseBranch, setRequestedBaseBranch] = useState<string | null>(null);
  const [requestedEntrants, setRequestedEntrants] = useState<RaceEntrantDraft[] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [starting, setStarting] = useState<number | null>(null);
  const busyRef = useRef(false);

  const latestRace = useMemo(() => groupRaces(threads)[0] ?? null, [threads]);
  const projectLabels = useMemo(
    () =>
      raceProjectLabels(
        projects.map((item) => ({
          key: projectKey(item.environmentId, item.id),
          title: item.title,
          workspaceRoot: item.workspaceRoot,
          environmentLabel:
            environments.find((env) => env.environmentId === item.environmentId)?.label ??
            "Computer",
        })),
      ),
    [environments, projects],
  );
  const project =
    (requestedProjectKey !== null
      ? projects.find((item) => projectKey(item.environmentId, item.id) === requestedProjectKey)
      : undefined) ??
    (latestRace
      ? projects.find(
          (item) =>
            item.environmentId === latestRace.environmentId && item.id === latestRace.projectId,
        )
      : undefined) ??
    projects.find((item) =>
      environments.some(
        (env) => env.environmentId === item.environmentId && env.connection.phase === "connected",
      ),
    ) ??
    projects[0];
  const environment = environments.find((item) => item.environmentId === project?.environmentId);
  const connected = environment?.connection.phase === "connected";
  const allProviders = environment?.serverConfig?.providers;
  const providers = useMemo(() => raceProviders(allProviders ?? []), [allProviders]);
  const entrants = useMemo(
    () =>
      requestedEntrants ??
      defaultRaceEntrants(
        providers,
        project?.defaultModelSelection ?? environment?.serverConfig?.settings.defaultModelSelection,
      ),
    [environment, project?.defaultModelSelection, providers, requestedEntrants],
  );

  const cwd = project && connected ? project.workspaceRoot : null;
  const statusQuery = useEnvironmentQuery(
    project && cwd !== null
      ? vcsEnvironment.status({ environmentId: project.environmentId, input: { cwd } })
      : null,
  );
  const refsQuery = useEnvironmentQuery(
    project && cwd !== null
      ? vcsEnvironment.listRefs({
          environmentId: project.environmentId,
          input: { cwd, refKind: "local", limit: 100 },
        })
      : null,
  );
  const branchOptions = useMemo(() => {
    const names = (refsQuery.data?.refs ?? [])
      .filter((ref) => ref.isRemote !== true)
      .map((ref) => ref.name);
    const current = statusQuery.data?.refName;
    return current && !names.includes(current) ? [current, ...names] : names;
  }, [refsQuery.data, statusQuery.data?.refName]);
  const baseBranch =
    (requestedBaseBranch !== null && branchOptions.includes(requestedBaseBranch)
      ? requestedBaseBranch
      : null) ??
    statusQuery.data?.refName ??
    refsQuery.data?.refs.find((ref) => ref.current)?.name ??
    branchOptions[0] ??
    "";
  const isRepo = statusQuery.data?.isRepo ?? refsQuery.data?.isRepo ?? null;

  const validation = validateRaceDraft({
    hasProject: project !== undefined,
    connected,
    isRepo,
    baseBranch,
    prompt,
    entrants,
    providers,
  });
  const busy = starting !== null;

  function updateEntrant(index: number, next: RaceEntrantDraft) {
    setRequestedEntrants(entrants.map((entrant, i) => (i === index ? next : entrant)));
  }

  async function startRace() {
    if (!project || !validation.ok || busyRef.current) return;
    busyRef.current = true;
    setStarting(entrants.length);
    const raceId = createRaceId();
    const count = entrants.length;
    const text = prompt.trim();
    const titleSeed = truncate(text);
    const createdAt = new Date().toISOString();
    try {
      // One bootstrap turn per entrant, shaped like ChatView's first send in
      // worktree mode; the server creates each worktree on its race branch.
      const results = await Promise.all(
        entrants.map((entrant, index) => {
          const provider = providers.find((item) => item.instanceId === entrant.instanceId)!;
          const modelSelection: ModelSelection = {
            instanceId: provider.instanceId,
            model: entrant.model,
          };
          const title = buildRaceEntrantTitle(
            titleSeed,
            `${raceProviderLabel(provider)} ${raceModelLabel(provider, entrant.model)}`,
          );
          return startTurn({
            environmentId: project.environmentId,
            input: {
              threadId: newThreadId(),
              message: { messageId: newMessageId(), role: "user", text, attachments: [] },
              modelSelection,
              // The bare seed differs from the suffixed title, so the server
              // keeps "<seed> · <entrant>" instead of generating a new title.
              titleSeed,
              runtimeMode: DEFAULT_RUNTIME_MODE,
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              bootstrap: {
                createThread: {
                  projectId: project.id,
                  title,
                  modelSelection,
                  runtimeMode: DEFAULT_RUNTIME_MODE,
                  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
                  branch: baseBranch,
                  worktreePath: null,
                  createdAt,
                },
                prepareWorktree: {
                  projectCwd: project.workspaceRoot,
                  baseBranch,
                  branch: buildRaceBranchName({ raceId, slot: index + 1, count }),
                },
                runSetupScript: true,
              },
              createdAt,
            },
          });
        }),
      );
      const failures = results.filter((result) => result._tag === "Failure");
      if (failures.length === 0) {
        rememberProject(projectKey(project.environmentId, project.id));
        setPrompt("");
        return;
      }
      const error = squashAtomCommandFailure(failures[0]!);
      toastManager.add({
        type: "error",
        title:
          failures.length === count
            ? "The race could not start"
            : `${count - failures.length} of ${count} entrants started`,
        description: error instanceof Error ? error.message : "An entrant failed to start.",
      });
    } finally {
      busyRef.current = false;
      setStarting(null);
    }
  }

  const pairDistinctModels = () => {
    const chosen: RaceEntrantDraft[] = [];
    for (const p of providers) {
      for (const m of p.models) {
        if (!chosen.some((c) => c.model === m.slug)) {
          chosen.push({ instanceId: p.instanceId, model: m.slug });
          break;
        }
      }
      if (chosen.length >= 2) break;
    }
    if (chosen.length >= 2) {
      setRequestedEntrants(chosen);
    }
  };

  if (projects.length === 0) {
    return (
      <p className="rounded-xl border border-border/70 bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
        Add a project from the sidebar to start a race.
      </p>
    );
  }

  return (
    <form
      aria-label="New race"
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-border/70 bg-card/60 p-4 shadow-xs sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void startRace();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Textarea
          aria-label="Race prompt"
          placeholder="Describe the task every entrant should attempt…"
          value={prompt}
          disabled={busy}
          rows={4}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void startRace();
            }
          }}
        />
        {prompt.trim().length > 0 ? (
          <div className="flex justify-end text-[11px] font-mono text-muted-foreground">
            <span>~{Math.ceil(prompt.length / 4)} tokens · {prompt.trim().split(/\s+/).length} words</span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">
          <span>Project</span>
          <RaceSelect
            ariaLabel="Race project"
            disabled={busy}
            value={project ? projectKey(project.environmentId, project.id) : ""}
            options={projects.map((item) => ({
              value: projectKey(item.environmentId, item.id),
              label: projectLabels.get(projectKey(item.environmentId, item.id)) ?? item.title,
            }))}
            placeholder="No projects"
            onChange={(value) => {
              setRequestedProjectKey(value);
              rememberProject(value);
              setRequestedBaseBranch(null);
              setRequestedEntrants(null);
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground">
          <span>Base branch</span>
          <RaceSelect
            ariaLabel="Race base branch"
            disabled={busy || branchOptions.length === 0}
            value={baseBranch}
            options={branchOptions.map((name) => ({
              value: name,
              label: name === statusQuery.data?.refName ? `${name} (checked out)` : name,
            }))}
            placeholder={
              statusQuery.isPending || refsQuery.isPending ? "Loading branches…" : "No branches"
            }
            onChange={setRequestedBaseBranch}
          />
        </div>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-2" disabled={busy}>
        <legend className="mb-1.5 flex w-full items-center justify-between text-xs text-muted-foreground">
          <span>Entrants</span>
          <span className="tabular-nums">
            {entrants.length} of {RACE_MAX_ENTRANTS}
          </span>
        </legend>
        {entrants.length === 0 ? (
          <p className="text-xs text-warning">
            {connected
              ? "Set up a ready provider in Settings → Providers."
              : "Connect this computer to choose entrants."}
          </p>
        ) : null}
        {entrants.map((entrant, index) => {
          const provider = providers.find((item) => item.instanceId === entrant.instanceId);
          const ProviderIcon = provider ? PROVIDER_ICON_BY_PROVIDER[provider.driver] : undefined;
          return (
            <div
              // Rows are positional: slot N becomes entrant N on the board.
              key={`slot-${index + 1}`}
              className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2"
            >
              <span className="flex size-6 items-center justify-center rounded-md bg-muted text-[11px] font-medium text-muted-foreground tabular-nums">
                {ProviderIcon ? <ProviderIcon className="size-3.5" /> : index + 1}
              </span>
              <RaceSelect
                ariaLabel={`Entrant ${index + 1} provider`}
                value={entrant.instanceId}
                options={[
                  ...(provider ? [] : [{ value: entrant.instanceId, label: "Unavailable" }]),
                  ...providers.map((item) => {
                    const Icon = PROVIDER_ICON_BY_PROVIDER[item.driver];
                    return {
                      value: item.instanceId,
                      label: raceProviderLabel(item),
                      icon: Icon ? <Icon className="size-3.5" /> : undefined,
                    };
                  }),
                ]}
                onChange={(value) => {
                  const next = providers.find((item) => item.instanceId === value);
                  if (!next) return;
                  updateEntrant(index, {
                    instanceId: next.instanceId,
                    model:
                      (next.models.find((model) => model.isDefault) ?? next.models[0])?.slug ?? "",
                  });
                }}
              />
              <RaceSelect
                ariaLabel={`Entrant ${index + 1} model`}
                value={entrant.model}
                disabled={!provider}
                options={[
                  ...(provider?.models.some((model) => model.slug === entrant.model)
                    ? []
                    : [{ value: entrant.model, label: "Choose a model" }]),
                  ...(provider?.models.map((model) => ({
                    value: model.slug,
                    label: getTriggerDisplayModelLabel(model),
                  })) ?? []),
                ]}
                onChange={(value) => updateEntrant(index, { ...entrant, model: value })}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove entrant ${index + 1}`}
                disabled={entrants.length <= 2}
                onClick={() => setRequestedEntrants(entrants.filter((_, i) => i !== index))}
              >
                <XIcon />
              </Button>
            </div>
          );
        })}
        {entrants.length > 0 && entrants.length < RACE_MAX_ENTRANTS ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start text-muted-foreground"
              onClick={() => {
                const next = nextRaceEntrant(providers, entrants);
                if (next) setRequestedEntrants([...entrants, next]);
              }}
            >
              <PlusIcon /> Add entrant
            </Button>
            {providers.length > 1 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="self-start text-muted-foreground"
                onClick={pairDistinctModels}
              >
                Auto-pair top models
              </Button>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
        <p
          className="min-w-0 flex-1 text-xs text-muted-foreground"
          aria-live="polite"
          role="status"
        >
          {busy
            ? `Preparing ${starting} worktrees from ${baseBranch}…`
            : validation.ok
              ? `Each entrant works in its own worktree from ${baseBranch}.`
              : validation.reason}
        </p>
        <Button type="submit" disabled={busy || !validation.ok}>
          <FlagIcon />
          {busy ? "Starting…" : `Start race · ${entrants.length}`}
        </Button>
      </div>
    </form>
  );
}
