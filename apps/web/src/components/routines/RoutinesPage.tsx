/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=9m; seat=codex; date=2026-10-10 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=29m; seat=codex; date=2026-10-09 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=30m; seat=codex; date=2026-10-08 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=35m; seat=codex; date=2026-10-02 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=grok-4.7; effort=default; duration=18m; seat=cursor; date=2026-09-30 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=15m; seat=antigravity; date=2026-10-01 */
import * as Cause from "effect/Cause";
import {
  previewRoutineOccurrences,
  routineScheduleIssue,
  sameRoutineConfiguration,
} from "@t3tools/shared/routines";
import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ProviderInstanceId,
  type RoutineDefinition,
  type RoutineClientMutation,
  type RuntimeMode,
} from "@t3tools/contracts";
import {
  createRoutineDraft,
  duplicateRoutine,
  importRoutineTemplate,
  serializeRoutineTemplate,
  ROUTINE_PROMPT_TEMPLATES,
  routineDraftIsDirty,
  routineDraftIssue,
  routineForSave,
  ROUTINE_SCHEDULE_PRESETS,
  setRoutineEnabled,
  selectRoutines,
} from "@t3tools/client-runtime/routines";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  CalendarClockIcon,
  CopyIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { cn, randomUUID } from "../../lib/utils";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { environmentSnapshotAtom } from "../../state/shell";
import { serverEnvironment } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  formatRoutineTime,
  ROUTINE_STATUS,
  routineConfigurationIssue,
  routineListSubtitle,
} from "./routinePresentation";
import { routineSchedulePreset } from "./routinePresets";
import { RoutineRunHistory } from "./RoutineRunHistory";

const EMPTY_ENVIRONMENT_ID = EnvironmentId.make("routines-unavailable");

const PROMPT_TEMPLATES = ROUTINE_PROMPT_TEMPLATES;

export function RoutinesPage() {
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const initialEnvironmentId =
    environments.find((item) => item.environmentId === primaryEnvironmentId)?.environmentId ??
    environments[0]?.environmentId ??
    null;
  const [requestedEnvironmentId, setRequestedEnvironmentId] = useState<EnvironmentId | null>(null);
  const environmentId = requestedEnvironmentId ?? initialEnvironmentId;
  const selectedEnvironment =
    environments.find((item) => item.environmentId === environmentId) ?? null;
  const selectedEnvironmentId = selectedEnvironment?.environmentId ?? null;
  const snapshot = useAtomValue(
    environmentSnapshotAtom(selectedEnvironmentId ?? EMPTY_ENVIRONMENT_ID),
  );
  const config = selectedEnvironment?.serverConfig ?? null;
  const overlapAvailable = config?.routineOverlapProtection === true;
  const dailyLimitAvailable = config?.routineDailyLaunchLimit === true;
  const connected = selectedEnvironment?.connection.phase === "connected" && config !== null;
  const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
  const providers = (config?.providers ?? []).filter(
    (provider) => provider.enabled && provider.installed && provider.models.length > 0,
  );
  const projects = snapshot?.projects ?? [];
  const routines = Object.entries(settings.routines).sort(([, left], [, right]) =>
    left.name.localeCompare(right.name),
  );
  const [routineSearch, setRoutineSearch] = useState("");
  const [routineStatusFilter, setRoutineStatusFilter] = useState<
    "all" | "active" | "paused" | "failed"
  >("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoutineDefinition | null>(null);
  const [baseline, setBaseline] = useState<RoutineDefinition | null>(null);
  const [saving, setSaving] = useState(false);
  const [templateInput, setTemplateInput] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const writeInFlight = useRef(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [routineAction, setRoutineAction] = useState<"run" | "delete" | "pause" | "resume" | null>(
    null,
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "routine update",
    reportFailure: false,
  });

  const filteredRoutines = selectRoutines(settings.routines, {
    status: routineStatusFilter,
    query: routineSearch,
  });
  const initialProvider = providers[0];
  const freshDraft = createRoutineDraft({
    overlapProtectionAvailable: overlapAvailable,
    projectId: projects[0]?.id,
    instanceId: initialProvider?.instanceId,
    model:
      initialProvider?.models.find((item) => item.isDefault)?.slug ??
      initialProvider?.models[0]?.slug,
  });

  const selectedProvider = providers.find(
    (provider) => provider.instanceId === draft?.modelSelection.instanceId,
  );
  const savedRoutine = editingId ? settings.routines[editingId] : undefined;
  const lastThreadId = savedRoutine?.lastThreadId ?? null;
  const runtimeRoutine = savedRoutine ?? draft;
  const dirty = draft !== null && routineDraftIsDirty(draft, baseline ?? undefined);
  const configurationChanged =
    baseline !== null &&
    savedRoutine !== undefined &&
    !sameRoutineConfiguration(baseline, savedRoutine);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  function leaveDraft(next: () => void) {
    if (writeInFlight.current) return;
    if (dirty) setPendingLeave(() => next);
    else next();
  }
  function cancelLeave() {
    setPendingLeave(null);
    if (blocker.status === "blocked") blocker.reset();
  }
  function discardDraft() {
    const next = pendingLeave;
    setPendingLeave(null);
    next?.();
    if (blocker.status === "blocked") blocker.proceed();
  }
  const draftCron = draft?.cron ?? "";
  const draftTimeZone = draft?.timeZone ?? "";
  const scheduleIssue = useMemo(
    () => routineScheduleIssue(draftCron, draftTimeZone),
    [draftCron, draftTimeZone],
  );
  const schedulePreview = useMemo(() => {
    if (!draftCron || !draftTimeZone || scheduleIssue) return [];
    try {
      return previewRoutineOccurrences(draftCron, draftTimeZone, new Date());
    } catch {
      return [];
    }
  }, [draftCron, draftTimeZone, scheduleIssue]);
  const configurationIssue = draft
    ? (routineConfigurationIssue({
        projectAvailable: projects.some((project) => project.id === draft.projectId),
        providerAvailable: selectedProvider !== undefined,
        modelAvailable:
          selectedProvider?.models.some((model) => model.slug === draft.modelSelection.model) ??
          false,
        timeZone: draft.timeZone,
      }) ??
      routineDraftIssue(
        draft,
        {
          projectAvailable: true,
          providerAvailable: true,
          modelAvailable: true,
          overlapProtectionAvailable: overlapAvailable,
          dailyLaunchLimitAvailable: dailyLimitAvailable,
        },
        scheduleIssue,
      ))
    : null;

  async function saveRoutine() {
    if (
      !selectedEnvironmentId ||
      !connected ||
      !draft ||
      configurationIssue ||
      configurationChanged ||
      writeInFlight.current
    )
      return;
    if (editingId && !savedRoutine) {
      toastManager.add({
        type: "error",
        title: "This routine was removed on another device",
        description: "Duplicate it to save a new routine.",
      });
      return;
    }
    const id = editingId ?? randomUUID();
    const saved = routineForSave(draft, savedRoutine);
    writeInFlight.current = true;
    setSaving(true);
    try {
      const result = await updateSettings({
        environmentId: selectedEnvironmentId,
        input: {
          patch: {
            routines: {
              [id]: editingId
                ? { _tag: "RoutineEdit", routine: saved, expected: baseline ?? savedRoutine! }
                : saved,
            },
          },
        },
      });
      if (result._tag === "Failure") throw Cause.squash(result.cause);
      setEditingId(id);
      setDraft(result.value.routines[id] ?? null);
      setBaseline(result.value.routines[id] ?? null);
      toastManager.add({ type: "success", title: "Routine saved" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Routine not saved",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      writeInFlight.current = false;
      setSaving(false);
    }
  }

  async function patchRoutine(id: string, routine: RoutineClientMutation | null): Promise<boolean> {
    if (!selectedEnvironmentId || !connected || writeInFlight.current) return false;
    writeInFlight.current = true;
    try {
      const result = await updateSettings({
        environmentId: selectedEnvironmentId,
        input: { patch: { routines: { [id]: routine } } },
      });
      if (result._tag === "Failure") throw Cause.squash(result.cause);
      if (routine !== null) {
        setDraft(result.value.routines[id] ?? null);
        setBaseline(result.value.routines[id] ?? null);
      }
      return true;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Routine update failed",
        description: error instanceof Error ? error.message : "Try again.",
      });
      return false;
    } finally {
      writeInFlight.current = false;
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
              disabled={saving || routineAction !== null}
              onChange={(event) => {
                const id = EnvironmentId.make(event.currentTarget.value);
                leaveDraft(() => {
                  setRequestedEnvironmentId(id);
                  setEditingId(null);
                  setBaseline(null);
                  setDraft(null);
                });
              }}
            >
              {!selectedEnvironment ? <option value="">Choose a computer</option> : null}
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
            ) : (
              <div className="grid overflow-hidden border-y border-border lg:grid-cols-[18rem_minmax(0,1fr)]">
                <aside className="border-b border-border lg:border-r lg:border-b-0">
                  <div className="flex flex-col gap-2 p-2">
                    <Button
                      className="w-full justify-start"
                      variant="outline"
                      disabled={
                        saving || routineAction !== null || !connected || freshDraft === null
                      }
                      onClick={() =>
                        leaveDraft(() => {
                          setEditingId(null);
                          setBaseline(null);
                          setDraft(freshDraft);
                        })
                      }
                    >
                      <PlusIcon /> New routine
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      disabled={
                        saving || routineAction !== null || !connected || freshDraft === null
                      }
                      onClick={() => {
                        setTemplateInput("");
                        setTemplateError(null);
                      }}
                    >
                      Import template
                    </Button>
                    {templateInput !== null ? (
                      <div className="space-y-2 border-y border-border py-3">
                        <p className="text-xs text-muted-foreground">
                          Paste exported JSON. Imports open paused. Review the project, provider,
                          model and permissions before saving.
                        </p>
                        <Textarea
                          aria-label="Routine template JSON"
                          value={templateInput}
                          onChange={(event) => setTemplateInput(event.target.value)}
                          rows={6}
                          className="font-mono text-xs"
                        />
                        {templateError ? (
                          <p role="alert" className="text-xs text-destructive">
                            {templateError}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={
                              !freshDraft ||
                              !templateInput.trim() ||
                              saving ||
                              routineAction !== null ||
                              !connected
                            }
                            onClick={() => {
                              if (!freshDraft) return;
                              try {
                                const imported = importRoutineTemplate(templateInput, freshDraft);
                                leaveDraft(() => {
                                  setEditingId(null);
                                  setBaseline(null);
                                  setDraft(imported);
                                  setTemplateInput(null);
                                  setTemplateError(null);
                                  toastManager.add({
                                    type: "success",
                                    title: "Template ready for review",
                                    description:
                                      "Paused draft. Choose this computer’s project and provider, then save.",
                                  });
                                });
                              } catch (error) {
                                setTemplateError(
                                  error instanceof Error
                                    ? error.message
                                    : "Could not import template.",
                                );
                              }
                            }}
                          >
                            Review template
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setTemplateInput(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {!connected || freshDraft === null ? (
                      <p className="px-2 text-xs text-muted-foreground">
                        {!connected
                          ? "Reconnect this computer to update routines."
                          : "Add a project and an installed provider to create a routine."}
                      </p>
                    ) : null}
                    <div className="relative">
                      <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                      <Input
                        value={routineSearch}
                        onChange={(e) => setRoutineSearch(e.currentTarget.value)}
                        placeholder="Search routines…"
                        className="h-8 pl-8 text-xs"
                      />
                    </div>
                    <div className="flex gap-1">
                      {(["all", "active", "paused", "failed"] as const).map((filter) => (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setRoutineStatusFilter(filter)}
                          className={cn(
                            "flex-1 rounded-sm px-1.5 py-0.5 text-center text-[11px] capitalize transition-colors",
                            routineStatusFilter === filter
                              ? "bg-muted font-medium text-foreground shadow-xs"
                              : "text-muted-foreground hover:bg-muted/40",
                          )}
                        >
                          {filter}
                        </button>
                      ))}
                    </div>
                  </div>
                  {filteredRoutines.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                      {routines.length === 0 ? "No routines configured." : "No matching routines."}
                    </p>
                  ) : (
                    filteredRoutines.map(([id, routine]) => (
                      <button
                        key={id}
                        type="button"
                        className={cn(
                          "relative w-full border-t border-border px-3 py-3 text-left transition-colors hover:bg-muted/50",
                          editingId === id && "bg-muted/60",
                        )}
                        disabled={saving || routineAction !== null}
                        onClick={() => {
                          if (id !== editingId)
                            leaveDraft(() => {
                              setEditingId(id);
                              setDraft(routine);
                              setBaseline(routine);
                            });
                        }}
                      >
                        {editingId === id ? (
                          <span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-foreground" />
                        ) : null}
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {routine.name}
                          </span>
                          <Badge variant={ROUTINE_STATUS[routine.lastRunStatus].variant}>
                            {routine.enabled
                              ? ROUTINE_STATUS[routine.lastRunStatus].label
                              : "Paused"}
                          </Badge>
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {routineListSubtitle(routine)}
                        </span>
                      </button>
                    ))
                  )}
                </aside>
                {draft ? (
                  <main className="min-w-0 p-4 sm:p-5">
                    <fieldset
                      disabled={saving || routineAction !== null || !connected}
                      className="min-w-0 space-y-6"
                    >
                      <div className="grid border-y border-border sm:grid-cols-3">
                        <RoutineFact
                          label="Next run"
                          value={
                            runtimeRoutine?.enabled
                              ? formatRoutineTime(runtimeRoutine.nextRunAt)
                              : "Paused"
                          }
                        />
                        <RoutineFact
                          label="Last run"
                          value={formatRoutineTime(runtimeRoutine?.lastRunAt ?? null)}
                        />
                        <div className="px-3 py-2.5 sm:border-l sm:border-border">
                          <span className="block text-xs text-muted-foreground">Result</span>
                          <Badge
                            className="mt-1"
                            variant={
                              ROUTINE_STATUS[runtimeRoutine?.lastRunStatus ?? "never"].variant
                            }
                          >
                            {ROUTINE_STATUS[runtimeRoutine?.lastRunStatus ?? "never"].label}
                          </Badge>
                          {runtimeRoutine?.lastError ? (
                            <p className="mt-1 line-clamp-2 text-xs text-destructive">
                              {runtimeRoutine.lastError}
                            </p>
                          ) : null}
                        </div>
                      </div>
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
                        <div className="sm:col-span-2 border-y border-border py-3 text-xs">
                          <label className="flex min-h-9 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={draft.catchUp !== false}
                              onChange={(event) =>
                                setDraft({ ...draft, catchUp: event.currentTarget.checked })
                              }
                            />{" "}
                            Catch up on one missed occurrence after coming online
                          </label>
                          <p className="mt-1 text-muted-foreground">
                            When off, occurrences more than five minutes late are skipped. Run now
                            remains available.
                          </p>
                          <label className="mt-3 flex min-h-9 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={draft.overlapPolicy === "skip"}
                              disabled={!overlapAvailable}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  overlapPolicy: event.currentTarget.checked ? "skip" : "allow",
                                })
                              }
                            />
                            Skip when a previous task is active
                          </label>
                          <p className="mt-1 text-muted-foreground">
                            {!overlapAvailable
                              ? "Update this environment to enable overlap protection. "
                              : ""}
                            Checks retained tasks before scheduled and Run now launches. A skipped
                            occurrence links to the active task. If activity cannot be checked, the
                            occurrence is skipped with that reason. Existing work continues.
                          </p>
                          <label className="mt-3 block">
                            <span className="block font-medium">Daily launch limit</span>
                            <Input
                              aria-label="Daily launch limit"
                              type="number"
                              min={1}
                              max={1000}
                              step={1}
                              className="mt-1 max-w-40"
                              disabled={!dailyLimitAvailable}
                              value={draft.dailyLaunchLimit ?? ""}
                              placeholder="No limit"
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  dailyLaunchLimit:
                                    event.currentTarget.value === ""
                                      ? null
                                      : Number(event.currentTarget.value),
                                })
                              }
                            />
                          </label>
                          <p className="mt-1 text-muted-foreground">
                            {!dailyLimitAvailable
                              ? "Update this environment to enable daily launch limits. "
                              : ""}
                            Scheduled and Run now attempts share this limit. Failed launches count;
                            skipped occurrences do not. Resets at midnight in the routine time zone.
                            This limits attempts, not spend. Leave blank to remove the limit.
                          </p>
                          {runtimeRoutine?.dailyLaunchUsage ? (
                            <p className="mt-1 text-muted-foreground">
                              Recorded {runtimeRoutine.dailyLaunchUsage.day} ·{" "}
                              {runtimeRoutine.dailyLaunchUsage.attempts} launch attempts
                              {" · "}
                              {runtimeRoutine.dailyLaunchUsage.timeZone}
                            </p>
                          ) : (
                            <p className="mt-1 text-muted-foreground">
                              No launch counter recorded yet; older launches are not reconstructed.
                            </p>
                          )}
                          <div className="mt-3 font-medium">
                            Next five scheduled occurrences · {draft.timeZone}
                          </div>
                          <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                            {schedulePreview.map((at) => (
                              <li key={at}>
                                {new Date(at).toLocaleString(undefined, {
                                  timeZone: draft.timeZone,
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZoneName: "short",
                                })}
                              </li>
                            ))}
                          </ol>
                          <p className="mt-2 text-muted-foreground">
                            Preview uses this device's clock. The connected environment schedules
                            launches.
                          </p>
                          {savedRoutine?.lastSkippedAt ? (
                            <p className="mt-2 text-muted-foreground">
                              Last skipped: {formatRoutineTime(savedRoutine.lastSkippedAt)}
                            </p>
                          ) : null}
                        </div>
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
                            {!selectedProvider && draft.modelSelection.instanceId ? (
                              <option value={draft.modelSelection.instanceId} disabled>
                                Unavailable · {draft.modelSelection.instanceId}
                              </option>
                            ) : null}
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
                            {selectedProvider &&
                            !selectedProvider.models.some(
                              (model) => model.slug === draft.modelSelection.model,
                            ) ? (
                              <option value={draft.modelSelection.model} disabled>
                                Unavailable · {draft.modelSelection.model}
                              </option>
                            ) : null}
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
                                setDraft(setRoutineEnabled(draft, event.currentTarget.checked))
                              }
                            />{" "}
                            Enabled
                          </label>
                        </Field>
                      </div>
                      <div>
                        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
                          <label className="text-xs font-medium text-muted-foreground">
                            Prompt
                          </label>
                          <div className="flex flex-wrap items-center gap-1">
                            <SparklesIcon className="size-3 text-muted-foreground" />
                            <span className="text-[11px] text-muted-foreground">Templates:</span>
                            {PROMPT_TEMPLATES.map((template) => (
                              <button
                                key={template.label}
                                type="button"
                                onClick={() => setDraft({ ...draft, prompt: template.prompt })}
                                className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              >
                                {template.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <Textarea
                          value={draft.prompt}
                          onChange={(event) =>
                            setDraft({ ...draft, prompt: event.currentTarget.value })
                          }
                        />
                      </div>
                      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                        Routines run on this environment while its T3 server is running. A missed
                        occurrence runs once when the server returns.
                      </p>
                      {configurationChanged && savedRoutine ? (
                        <div
                          role="alert"
                          className="border-l-2 border-warning bg-warning/8 px-3 py-2"
                        >
                          <p className="text-sm text-warning-foreground">
                            This routine changed on another device. Review the saved version before
                            saving or running it. Your draft is still here.
                          </p>
                          <Button
                            variant="outline"
                            className="mt-2"
                            disabled={saving || routineAction !== null}
                            onClick={() =>
                              leaveDraft(() => {
                                setDraft(savedRoutine);
                                setBaseline(savedRoutine);
                              })
                            }
                          >
                            Review saved version
                          </Button>
                        </div>
                      ) : null}
                      {configurationIssue ? (
                        <p
                          role="alert"
                          className="border-l-2 border-warning bg-warning/8 px-3 py-2 text-sm text-warning-foreground"
                        >
                          {configurationIssue}
                        </p>
                      ) : null}
                      {runtimeRoutine?.lastError ? (
                        <div
                          role="alert"
                          className="border-l-2 border-destructive bg-destructive/8 px-3 py-2"
                        >
                          <p className="text-sm font-medium text-destructive-foreground">
                            Last run failed
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {runtimeRoutine.lastError}
                          </p>
                        </div>
                      ) : null}
                      {editingId && dirty ? (
                        <p className="text-xs text-muted-foreground">
                          Save your changes before running or deleting this routine.
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={
                            saving ||
                            routineAction !== null ||
                            configurationIssue !== null ||
                            configurationChanged ||
                            !draft.name.trim() ||
                            !draft.prompt.trim() ||
                            !draft.cron.trim()
                          }
                          onClick={() => void saveRoutine()}
                        >
                          {saving ? "Saving…" : "Save routine"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            try {
                              const text = serializeRoutineTemplate(draft);
                              const url = URL.createObjectURL(
                                new Blob([text], { type: "application/json" }),
                              );
                              const link = document.createElement("a");
                              link.href = url;
                              link.download = `${draft.name.replace(/[^a-z0-9_-]/gi, "-").slice(0, 80) || "routine"}.routine.json`;
                              link.click();
                              setTimeout(() => URL.revokeObjectURL(url), 1000);
                            } catch (error) {
                              toastManager.add({
                                type: "error",
                                title: "Could not export template",
                                description:
                                  error instanceof Error
                                    ? error.message
                                    : "Review the routine configuration.",
                              });
                            }
                          }}
                        >
                          Export template
                        </Button>
                        {editingId ? (
                          <>
                            <Button
                              variant="outline"
                              disabled={
                                routineAction !== null ||
                                saving ||
                                dirty ||
                                configurationChanged ||
                                !savedRoutine ||
                                savedRoutine.lastRunStatus === "running" ||
                                configurationIssue !== null
                              }
                              onClick={() => {
                                if (!savedRoutine || writeInFlight.current) return;
                                setRoutineAction("run");
                                void patchRoutine(editingId, {
                                  _tag: "RoutineAction",
                                  action: "run-now",
                                }).then((updated) => {
                                  if (updated) {
                                    toastManager.add({
                                      type: "success",
                                      title: "Routine queued",
                                      description:
                                        "A new task will appear when the server launches it.",
                                    });
                                  }
                                  setRoutineAction(null);
                                });
                              }}
                            >
                              <PlayIcon /> {routineAction === "run" ? "Queueing…" : "Run now"}
                            </Button>
                            <Button
                              variant="outline"
                              disabled={
                                saving ||
                                routineAction !== null ||
                                dirty ||
                                configurationChanged ||
                                !savedRoutine ||
                                (savedRoutine.enabled === false && configurationIssue !== null)
                              }
                              onClick={() => {
                                if (!savedRoutine || writeInFlight.current) return;
                                const enabled = !savedRoutine.enabled;
                                setRoutineAction(enabled ? "resume" : "pause");
                                void patchRoutine(editingId, {
                                  _tag: "RoutineAction",
                                  action: enabled ? "resume" : "pause",
                                }).then((updated) => {
                                  if (updated) {
                                    toastManager.add({
                                      type: "success",
                                      title: enabled ? "Routine resumed" : "Routine paused",
                                    });
                                  }
                                  setRoutineAction(null);
                                });
                              }}
                            >
                              {savedRoutine?.enabled ? "Pause" : "Resume"}
                            </Button>
                            {lastThreadId && selectedEnvironmentId ? (
                              <Button
                                variant="outline"
                                onClick={() =>
                                  void navigate({
                                    to: "/$environmentId/$threadId",
                                    params: buildThreadRouteParams(
                                      scopeThreadRef(selectedEnvironmentId, lastThreadId),
                                    ),
                                  })
                                }
                              >
                                <ArrowUpRightIcon /> Open last task
                              </Button>
                            ) : null}
                            <Button
                              variant="outline"
                              onClick={() => {
                                setEditingId(null);
                                setBaseline(null);
                                setDraft(duplicateRoutine(draft));
                              }}
                            >
                              <CopyIcon /> Duplicate
                            </Button>
                            <Button
                              variant="destructive"
                              disabled={
                                routineAction !== null ||
                                saving ||
                                dirty ||
                                configurationChanged ||
                                !savedRoutine
                              }
                              onClick={() => {
                                if (writeInFlight.current) return;
                                setRoutineAction("delete");
                                void patchRoutine(editingId, null).then((updated) => {
                                  if (updated) {
                                    setEditingId(null);
                                    setBaseline(null);
                                    setDraft(null);
                                    toastManager.add({ type: "success", title: "Routine deleted" });
                                  }
                                  setRoutineAction(null);
                                });
                              }}
                            >
                              <Trash2Icon /> {routineAction === "delete" ? "Deleting…" : "Delete"}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </fieldset>
                    {savedRoutine && editingId && selectedEnvironmentId ? (
                      <RoutineRunHistory
                        key={`${selectedEnvironmentId}:${editingId}`}
                        routine={savedRoutine}
                        routineId={editingId}
                        environmentId={selectedEnvironmentId}
                        onOpenThread={(threadId) =>
                          leaveDraft(() => {
                            void navigate({
                              to: "/$environmentId/$threadId",
                              params: buildThreadRouteParams(
                                scopeThreadRef(selectedEnvironmentId, threadId),
                              ),
                            });
                          })
                        }
                      />
                    ) : null}
                  </main>
                ) : (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    Select a routine or create one.
                  </div>
                )}
              </div>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
      <AlertDialog
        open={pendingLeave !== null || blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) cancelLeave();
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>Your saved routine will stay as it is.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep editing</AlertDialogClose>
            <Button variant="destructive" onClick={discardDraft}>
              Discard
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SidebarInset>
  );
}

function RoutineFact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="border-b border-border px-3 py-2.5 last:border-b-0 sm:border-b-0 sm:not-first:border-l">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="mt-1 block truncate text-sm">{value}</span>
    </div>
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
