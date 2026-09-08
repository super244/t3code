import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ProviderInstanceId,
  type RoutineDefinition,
  type RuntimeMode,
} from "@t3tools/contracts";
import { CalendarClockIcon, CopyIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { environmentSnapshotAtom } from "../../state/shell";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  ROUTINE_SCHEDULE_PRESETS,
  routineScheduleLabel,
  routineSchedulePreset,
} from "./routinePresets";

type RoutineDraft = Omit<RoutineDefinition, "modelSelection"> & {
  readonly modelSelection: { readonly instanceId: ProviderInstanceId; readonly model: string };
};

const EMPTY_ENVIRONMENT_ID = EnvironmentId.make("routines-unavailable");

function defaultDraft(
  projectId: string | undefined,
  instanceId: ProviderInstanceId | undefined,
  model: string | undefined,
): RoutineDraft | null {
  if (!projectId || !instanceId || !model) return null;
  return {
    name: "Daily routine",
    enabled: true,
    cron: "0 7 * * *",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    projectId: projectId as RoutineDefinition["projectId"],
    prompt: "Review this project and complete the next clearly scoped priority.",
    modelSelection: { instanceId, model },
    runtimeMode: "full-access",
    interactionMode: "default",
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: "never",
    lastThreadId: null,
    lastError: null,
  };
}

export function RoutinesPage() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const initialEnvironmentId =
    environments.find((item) => item.environmentId === primaryEnvironmentId)?.environmentId ??
    environments[0]?.environmentId ??
    null;
  const [requestedEnvironmentId, setRequestedEnvironmentId] = useState<EnvironmentId | null>(null);
  const environmentId = requestedEnvironmentId ?? initialEnvironmentId;
  const selectedEnvironment =
    environments.find((item) => item.environmentId === environmentId) ?? environments[0] ?? null;
  const selectedEnvironmentId = selectedEnvironment?.environmentId ?? null;
  const snapshot = useAtomValue(
    environmentSnapshotAtom(selectedEnvironmentId ?? EMPTY_ENVIRONMENT_ID),
  );
  const config = selectedEnvironment?.serverConfig ?? null;
  const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
  const providers = (config?.providers ?? []).filter(
    (provider) => provider.enabled && provider.installed && provider.models.length > 0,
  );
  const projects = snapshot?.projects ?? [];
  const routines = Object.entries(settings.routines).sort(([, left], [, right]) =>
    left.name.localeCompare(right.name),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoutineDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, "routine update");

  const freshDraft = useMemo(() => {
    const provider = providers[0];
    const model =
      provider?.models.find((item) => item.isDefault)?.slug ?? provider?.models[0]?.slug;
    return defaultDraft(projects[0]?.id, provider?.instanceId, model);
  }, [projects, providers]);

  const selectedProvider = providers.find(
    (provider) => provider.instanceId === draft?.modelSelection.instanceId,
  );

  async function saveRoutine() {
    if (!selectedEnvironmentId || !draft) return;
    const id = editingId ?? crypto.randomUUID();
    setSaving(true);
    try {
      const result = await updateSettings({
        environmentId: selectedEnvironmentId,
        input: { patch: { routines: { [id]: { ...draft, nextRunAt: null } } } },
      });
      if (result._tag === "Failure") throw new Error("The environment rejected the routine.");
      setEditingId(id);
      toastManager.add({ type: "success", title: "Routine saved" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Routine not saved",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function patchRoutine(id: string, routine: RoutineDefinition | null) {
    if (!selectedEnvironmentId) return;
    const result = await updateSettings({
      environmentId: selectedEnvironmentId,
      input: { patch: { routines: { [id]: routine } } },
    });
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Routine update failed" });
    }
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader electron={isElectron} className="h-auto">
          <div className="flex w-full items-center gap-3 py-2">
            <CalendarClockIcon className="size-4" />
            <h1 className="font-medium">Routines</h1>
            <select
              aria-label="Routine environment"
              className="ml-auto h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={selectedEnvironmentId ?? ""}
              onChange={(event) => {
                setRequestedEnvironmentId(EnvironmentId.make(event.currentTarget.value));
                setEditingId(null);
                setDraft(null);
              }}
            >
              {environments.map((environment) => (
                <option key={environment.environmentId} value={environment.environmentId}>
                  {environment.label}
                </option>
              ))}
            </select>
          </div>
        </WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            {!config ? (
              <p className="text-sm text-muted-foreground">
                Connect an environment to manage routines.
              </p>
            ) : projects.length === 0 || providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add a project and authenticate a provider before creating a routine.
              </p>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
                <aside className="space-y-2">
                  <Button
                    className="w-full justify-start"
                    variant="outline"
                    onClick={() => {
                      setEditingId(null);
                      setDraft(freshDraft);
                    }}
                  >
                    <PlusIcon /> New routine
                  </Button>
                  {routines.map(([id, routine]) => (
                    <button
                      key={id}
                      type="button"
                      className="w-full rounded-lg border border-border p-3 text-left hover:bg-muted/50"
                      onClick={() => {
                        setEditingId(id);
                        setDraft(routine);
                      }}
                    >
                      <span className="block truncate text-sm font-medium">{routine.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {routine.enabled ? routineScheduleLabel(routine.cron) : "Paused"} ·{" "}
                        {routine.lastRunStatus}
                      </span>
                    </button>
                  ))}
                </aside>
                {draft ? (
                  <main className="space-y-5 rounded-xl border border-border p-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Name">
                        <Input
                          value={draft.name}
                          onChange={(event) =>
                            setDraft({ ...draft, name: event.currentTarget.value })
                          }
                        />
                      </Field>
                      <Field label="Schedule">
                        <select
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={routineSchedulePreset(draft.cron)}
                          onChange={(event) => {
                            setDraft({
                              ...draft,
                              cron:
                                event.currentTarget.value === "custom"
                                  ? ""
                                  : event.currentTarget.value,
                              nextRunAt: null,
                            });
                          }}
                        >
                          {ROUTINE_SCHEDULE_PRESETS.map((preset) => (
                            <option key={preset.value} value={preset.value}>
                              {preset.label}
                            </option>
                          ))}
                          <option value="custom">Custom cron…</option>
                        </select>
                        {routineSchedulePreset(draft.cron) === "custom" ? (
                          <Input
                            className="mt-2"
                            value={draft.cron}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                cron: event.currentTarget.value,
                                nextRunAt: null,
                              })
                            }
                            placeholder="0 7 * * *"
                          />
                        ) : null}
                      </Field>
                      <Field label="Time zone">
                        <Input
                          value={draft.timeZone}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              timeZone: event.currentTarget.value,
                              nextRunAt: null,
                            })
                          }
                        />
                      </Field>
                      <Field label="Project">
                        <select
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={draft.projectId}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              projectId: event.currentTarget
                                .value as RoutineDefinition["projectId"],
                            })
                          }
                        >
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.title}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Provider subscription">
                        <select
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={draft.modelSelection.instanceId}
                          onChange={(event) => {
                            const instanceId = event.currentTarget.value as ProviderInstanceId;
                            const provider = providers.find(
                              (item) => item.instanceId === instanceId,
                            );
                            const model =
                              provider?.models.find((item) => item.isDefault)?.slug ??
                              provider?.models[0]?.slug ??
                              "";
                            setDraft({ ...draft, modelSelection: { instanceId, model } });
                          }}
                        >
                          {providers.map((provider) => (
                            <option key={provider.instanceId} value={provider.instanceId}>
                              {provider.displayName ?? provider.instanceId}
                              {provider.auth.email ? ` · ${provider.auth.email}` : ""}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Model">
                        <select
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={draft.modelSelection.model}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              modelSelection: {
                                ...draft.modelSelection,
                                model: event.currentTarget.value,
                              },
                            })
                          }
                        >
                          {(selectedProvider?.models ?? []).map((model) => (
                            <option key={model.slug} value={model.slug}>
                              {model.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Permission mode">
                        <select
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={draft.runtimeMode}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              runtimeMode: event.currentTarget.value as RuntimeMode,
                            })
                          }
                        >
                          <option value="full-access">Full access</option>
                          <option value="auto">Auto</option>
                          <option value="auto-accept-edits">Auto-accept edits</option>
                          <option value="approval-required">Approval required</option>
                        </select>
                      </Field>
                      <Field label="Status">
                        <label className="flex h-8 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(event) =>
                              setDraft({ ...draft, enabled: event.currentTarget.checked })
                            }
                          />{" "}
                          Enabled
                        </label>
                      </Field>
                    </div>
                    <Field label="Prompt">
                      <Textarea
                        value={draft.prompt}
                        onChange={(event) =>
                          setDraft({ ...draft, prompt: event.currentTarget.value })
                        }
                      />
                    </Field>
                    <p className="text-xs text-muted-foreground">
                      Routines run on this environment while its T3 server is running. A missed
                      occurrence runs once when the server returns.
                      {draft.nextRunAt
                        ? ` Next: ${new Date(draft.nextRunAt).toLocaleString()}.`
                        : ""}
                      {draft.lastError ? ` Last error: ${draft.lastError}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={
                          saving || !draft.name.trim() || !draft.prompt.trim() || !draft.cron.trim()
                        }
                        onClick={() => void saveRoutine()}
                      >
                        {saving ? "Saving…" : "Save routine"}
                      </Button>
                      {editingId ? (
                        <>
                          <Button
                            variant="outline"
                            onClick={() =>
                              void patchRoutine(editingId, {
                                ...draft,
                                enabled: true,
                                nextRunAt: new Date(Date.now() - 1_000).toISOString(),
                                lastRunStatus: "never",
                                lastError: null,
                              })
                            }
                          >
                            <PlayIcon /> Run now
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setEditingId(null);
                              setDraft({
                                ...draft,
                                name: `${draft.name} copy`,
                                nextRunAt: null,
                                lastRunAt: null,
                                lastRunStatus: "never",
                                lastThreadId: null,
                                lastError: null,
                              });
                            }}
                          >
                            <CopyIcon /> Duplicate
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => {
                              void patchRoutine(editingId, null);
                              setEditingId(null);
                              setDraft(null);
                            }}
                          >
                            <Trash2Icon /> Delete
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </main>
                ) : (
                  <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                    Select a routine or create one.
                  </div>
                )}
              </div>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}
