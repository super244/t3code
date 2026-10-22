/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=125m; seat=codex; date=2026-10-14 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=9m; seat=codex; date=2026-10-10 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=29m; seat=codex; date=2026-10-09 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=30m; seat=codex; date=2026-10-08 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=35m; seat=codex; date=2026-10-02 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=15m; seat=antigravity; date=2026-10-01 */
import * as Cause from "effect/Cause";
import {
  previewRoutineOccurrences,
  routineScheduleIssue,
  sameRoutineConfiguration,
} from "@t3tools/shared/routines";
import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation, usePreventRemove } from "@react-navigation/native";
import {
  createRoutineDraft,
  makeRoutineBulkAction,
  duplicateRoutine,
  importRoutineTemplate,
  serializeRoutineTemplate,
  ROUTINE_PROMPT_TEMPLATES,
  ROUTINE_RUN_LABELS,
  ROUTINE_SCHEDULE_PRESETS,
  routineDraftIsDirty,
  routineDraftIssue,
  routineForSave,
  selectRoutines,
} from "@t3tools/client-runtime/routines";
import {
  EnvironmentId,
  type ProviderInteractionMode,
  type RoutineDefinition,
  type RoutineClientMutation,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Platform, Pressable, ScrollView, Share, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ControlPillMenu } from "../../components/ControlPill";
import { cn } from "../../lib/cn";
import { uuidv4 } from "../../lib/uuid";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironments } from "../../state/environments";
import { environmentSnapshotAtom } from "../../state/shell";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { RoutineRunHistory } from "./RoutineRunHistory";

const EMPTY_ENVIRONMENT_ID = EnvironmentId.make("routines-unavailable");
const PERMISSION_OPTIONS: readonly { value: RuntimeMode; label: string }[] = [
  { value: "full-access", label: "Full access" },
  { value: "auto", label: "Auto" },
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "approval-required", label: "Approval required" },
];
const INTERACTION_OPTIONS: readonly { value: ProviderInteractionMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "plan", label: "Plan" },
];

function routineTime(value: string | null): string {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function SettingsRoutinesRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const [requestedEnvironmentId, setRequestedEnvironmentId] = useState<EnvironmentId | null>(null);
  const environment =
    requestedEnvironmentId === null
      ? (environments[0] ?? null)
      : (environments.find((item) => item.environmentId === requestedEnvironmentId) ?? null);
  const environmentId = environment?.environmentId ?? null;
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const overlapAvailable = config?.routineOverlapProtection === true;
  const dailyLimitAvailable = config?.routineDailyLaunchLimit === true;
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? EMPTY_ENVIRONMENT_ID));
  const projects = snapshot?.projects ?? [];
  const providers = (config?.providers ?? []).filter(
    (provider) => provider.enabled && provider.installed && provider.models.length > 0,
  );
  const routines = config?.settings.routines ?? {};
  const connected = environment?.connection.phase === "connected" && config !== null;
  const [editor, setEditor] = useState<{
    id: string | null;
    draft: RoutineDefinition;
    baseline: RoutineDefinition | null;
  } | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const writeInFlight = useRef(false);
  const [templateInput, setTemplateInput] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused" | "failed">("all");
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "routine update",
    reportFailure: false,
  });
  const draft = editor?.draft ?? null;
  const savedRoutine = editor?.id ? routines[editor.id] : undefined;
  const selectedProvider = providers.find(
    (provider) => provider.instanceId === draft?.modelSelection.instanceId,
  );
  const dirty = draft !== null && routineDraftIsDirty(draft, editor?.baseline ?? undefined);
  const configurationChanged =
    editor?.baseline != null &&
    savedRoutine !== undefined &&
    !sameRoutineConfiguration(editor.baseline, savedRoutine);
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
  const issue = draft
    ? routineDraftIssue(
        draft,
        {
          projectAvailable: projects.some((project) => project.id === draft.projectId),
          overlapProtectionAvailable: overlapAvailable,
          dailyLaunchLimitAvailable: dailyLimitAvailable,
          providerAvailable: selectedProvider !== undefined,
          modelAvailable:
            selectedProvider?.models.some((model) => model.slug === draft.modelSelection.model) ??
            false,
        },
        scheduleIssue,
      )
    : null;
  const freshDraft = createRoutineDraft({
    overlapProtectionAvailable: overlapAvailable,
    projectId: projects[0]?.id,
    instanceId: providers[0]?.instanceId,
    model:
      providers[0]?.models.find((model) => model.isDefault)?.slug ?? providers[0]?.models[0]?.slug,
  });

  const routineEntries = Object.entries(routines).sort(([, left], [, right]) =>
    left.name.localeCompare(right.name),
  );
  const filteredRoutines = selectRoutines(routines, { status: statusFilter, query: searchQuery });

  usePreventRemove(dirty && action === null, ({ data }) => {
    Alert.alert("Discard unsaved changes?", "Your saved routine will stay as it is.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  function changeDraft(patch: Partial<RoutineDefinition>) {
    setEditor((current) =>
      current ? { ...current, draft: { ...current.draft, ...patch } } : current,
    );
    setNotice(null);
  }

  function leaveDraft(next: () => void) {
    if (!dirty) {
      next();
      return;
    }
    Alert.alert("Discard unsaved changes?", "Your saved routine will stay as it is.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: next },
    ]);
  }

  async function writeRoutine(id: string, value: RoutineClientMutation | null, kind: string) {
    if (!environmentId || !connected || writeInFlight.current) return;
    writeInFlight.current = true;
    setAction(kind);
    setNotice(null);
    try {
      const result = await updateSettings({
        environmentId,
        input: { patch: { routines: { [id]: value } } },
      });
      if (result._tag === "Failure") throw Cause.squash(result.cause);
      const saved = result.value.routines[id];
      setEditor(saved ? { id, draft: saved, baseline: saved } : null);
      setNotice({
        error: false,
        text:
          kind === "run"
            ? "Routine queued. Its task will appear after the next scheduler sweep."
            : kind === "delete"
              ? "Routine deleted."
              : kind === "pause"
                ? "Routine paused."
                : kind === "resume"
                  ? "Routine resumed."
                  : "Routine saved.",
      });
    } catch (error) {
      setNotice({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : "Routine update failed. Your changes are still here.",
      });
    } finally {
      writeInFlight.current = false;
      setAction(null);
    }
  }

  function reviewBulk(kind: "pause" | "resume") {
    if (
      !environmentId ||
      !connected ||
      dirty ||
      config?.routineBulkActions !== true ||
      writeInFlight.current
    )
      return;
    let batch: ReturnType<typeof makeRoutineBulkAction>;
    try {
      batch = makeRoutineBulkAction(filteredRoutines, kind);
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "Narrow the routine filter.",
      });
      return;
    }
    if (!batch.count) return;
    const targetEnvironment = environmentId;
    Alert.alert(
      `${kind === "pause" ? "Pause" : "Resume"} ${batch.count} routine schedules?`,
      `${batch.names.join("\n")}\n\n${kind === "pause" ? "Future scheduled launches pause. Running tasks continue." : "Schedules resume from their next occurrence; no immediate run is requested."}\nIf any configuration changed, the whole batch is refused.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Apply",
          onPress: () => {
            void (async () => {
              if (writeInFlight.current) return;
              writeInFlight.current = true;
              setAction("bulk");
              setNotice(null);
              try {
                const result = await updateSettings({
                  environmentId: targetEnvironment,
                  input: { patch: { routines: batch.routines } },
                });
                if (result._tag === "Failure") throw Cause.squash(result.cause);
                setNotice({
                  error: false,
                  text: `${kind === "pause" ? "Paused" : "Resumed"} ${batch.count} routine schedules.`,
                });
              } catch (error) {
                setNotice({
                  error: true,
                  text:
                    error instanceof Error
                      ? error.message
                      : "Routine batch was not applied. Refresh and review again.",
                });
              } finally {
                writeInFlight.current = false;
                setAction(null);
              }
            })();
          },
        },
      ],
    );
  }

  function save() {
    if (!editor || issue || configurationChanged) return;
    if (editor.id !== null && !savedRoutine) {
      setNotice({
        error: true,
        text: "This routine was removed on another device. Duplicate it to create a new routine.",
      });
      return;
    }
    const saved = routineForSave(editor.draft, savedRoutine);
    void writeRoutine(
      editor.id ?? uuidv4(),
      editor.id
        ? { _tag: "RoutineEdit", routine: saved, expected: editor.baseline ?? savedRoutine! }
        : saved,
      "save",
    );
  }

  function openLastTask() {
    if (!environmentId || !savedRoutine?.lastThreadId) return;
    openTask(savedRoutine.lastThreadId);
  }

  function openTask(threadId: ThreadId) {
    if (!environmentId) return;
    leaveDraft(() => {
      const params = { environmentId, threadId };
      const root = navigation.getParent()?.getParent();
      if (root) root.dispatch(StackActions.popTo("Thread", params));
      else navigation.navigate("Thread", params);
    });
  }

  const disabled = !connected || action !== null;
  const persistedActionDisabled =
    disabled || dirty || configurationChanged || savedRoutine === undefined;

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Routines" onBack={() => navigation.goBack()} />
        </>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <Text className="text-sm leading-normal text-foreground-muted">
          Run a project prompt on a recurring schedule while its environment is online.
        </Text>
        <Selector
          label="Environment"
          value={environmentId ?? ""}
          options={environments.map((item) => ({ value: item.environmentId, label: item.label }))}
          disabled={action !== null}
          onSelect={(value) =>
            leaveDraft(() => {
              setRequestedEnvironmentId(EnvironmentId.make(value));
              setEditor(null);
              setNotice(null);
            })
          }
        />
        {!environment ? (
          <Text className="text-sm text-foreground-muted">
            Connect an environment in Settings to manage routines.
          </Text>
        ) : !connected ? (
          <Text accessibilityRole="alert" className="text-sm text-warning">
            {environment.connection.phase === "connecting" ||
            environment.connection.phase === "reconnecting"
              ? "Connecting to this environment…"
              : "This environment is offline. Saved routines are visible when cached; reconnect to save or run them."}
          </Text>
        ) : null}
        <Action
          label="Import template"
          disabled={action !== null || !connected || !freshDraft}
          onPress={() => {
            setTemplateInput("");
            setTemplateError(null);
          }}
        />
        {templateInput !== null ? (
          <View className="gap-3 border-y border-border py-3">
            <Text className="text-sm text-foreground-muted">
              Paste exported JSON. Imports open paused. Review the local project, provider, model
              and permissions before saving.
            </Text>
            <TextInput
              accessibilityLabel="Routine template JSON"
              value={templateInput}
              onChangeText={setTemplateInput}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Paste routine template JSON"
            />
            {templateError ? (
              <Text accessibilityRole="alert" className="text-sm text-danger">
                {templateError}
              </Text>
            ) : null}
            <Action
              label="Review template"
              disabled={!freshDraft || !templateInput.trim() || action !== null || !connected}
              onPress={() => {
                if (!freshDraft) return;
                try {
                  const imported = importRoutineTemplate(templateInput, freshDraft);
                  leaveDraft(() => {
                    setEditor({ id: null, draft: imported, baseline: null });
                    setTemplateInput(null);
                    setTemplateError(null);
                    setNotice({
                      error: false,
                      text: "Paused draft. Choose this environment’s project and provider, then save.",
                    });
                  });
                } catch (error) {
                  setTemplateError(
                    error instanceof Error ? error.message : "Could not import template.",
                  );
                }
              }}
              primary
            />
            <Action
              label="Cancel import"
              disabled={action !== null}
              onPress={() => setTemplateInput(null)}
            />
          </View>
        ) : null}
        {notice ? (
          <Text
            accessibilityRole="alert"
            className={notice.error ? "text-sm text-danger" : "text-sm text-success"}
          >
            {notice.text}
          </Text>
        ) : null}
        {!editor ? (
          <>
            <Action
              label="New routine"
              disabled={disabled || freshDraft === null}
              onPress={() => {
                if (freshDraft && environmentId) {
                  setRequestedEnvironmentId(environmentId);
                  setEditor({ id: null, draft: freshDraft, baseline: null });
                  setNotice(null);
                }
              }}
              primary
            />
            {connected && freshDraft === null ? (
              <Text className="text-sm text-foreground-muted">
                Add a project and an installed provider with available models before creating a
                routine.
              </Text>
            ) : null}
            {routineEntries.length > 0 ? (
              <View className="gap-3">
                <TextInput
                  accessibilityLabel="Search routines"
                  placeholder="Search routines…"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
                <View className="flex-row flex-wrap gap-2">
                  {(
                    [
                      { id: "all", label: `All (${routineEntries.length})` },
                      {
                        id: "active",
                        label: `Active (${selectRoutines(routines, { status: "active" }).length})`,
                      },
                      {
                        id: "paused",
                        label: `Paused (${routineEntries.filter(([, r]) => !r.enabled).length})`,
                      },
                      {
                        id: "failed",
                        label: `Failed (${routineEntries.filter(([, r]) => r.lastRunStatus === "failed").length})`,
                      },
                    ] as const
                  ).map((tab) => {
                    const isSelected = statusFilter === tab.id;
                    return (
                      <Pressable
                        key={tab.id}
                        accessibilityRole="button"
                        accessibilityLabel={tab.label}
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => setStatusFilter(tab.id)}
                        className={cn(
                          "rounded-full border px-3 py-1.5",
                          isSelected ? "border-primary bg-primary/10" : "border-border bg-subtle",
                        )}
                      >
                        <Text
                          className={cn(
                            "text-xs font-t3-medium",
                            isSelected ? "text-primary" : "text-foreground-muted",
                          )}
                        >
                          {tab.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
            {filteredRoutines.length > 0 ? (
              <View className="gap-2 border-t border-border py-3">
                <View className="flex-row flex-wrap gap-2">
                  <Action
                    label={`Pause visible (${filteredRoutines.filter(([, routine]) => routine.enabled).length})`}
                    disabled={
                      disabled ||
                      dirty ||
                      config?.routineBulkActions !== true ||
                      !filteredRoutines.some(([, routine]) => routine.enabled)
                    }
                    onPress={() => reviewBulk("pause")}
                  />
                  <Action
                    label={`Resume visible (${filteredRoutines.filter(([, routine]) => !routine.enabled).length})`}
                    disabled={
                      disabled ||
                      dirty ||
                      config?.routineBulkActions !== true ||
                      !filteredRoutines.some(([, routine]) => !routine.enabled)
                    }
                    onPress={() => reviewBulk("resume")}
                  />
                </View>
                {config?.routineBulkActions !== true ? (
                  <Text className="text-xs text-foreground-muted">
                    Update this computer to use reviewed batch controls.
                  </Text>
                ) : null}
              </View>
            ) : null}
            <View className="border-y border-border">
              {filteredRoutines.map(([id, routine]) => (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${routine.name}`}
                  onPress={() => {
                    setRequestedEnvironmentId(environmentId);
                    setEditor({ id, draft: routine, baseline: routine });
                    setNotice(null);
                  }}
                  className="gap-1 border-b border-border px-1 py-4"
                >
                  <View className="flex-row items-center gap-3">
                    <Text className="min-w-0 flex-1 text-base font-t3-medium" numberOfLines={1}>
                      {routine.name}
                    </Text>
                    <Text
                      className={
                        routine.lastRunStatus === "failed"
                          ? "text-xs text-danger"
                          : "text-xs text-foreground-muted"
                      }
                    >
                      {routine.enabled ? ROUTINE_RUN_LABELS[routine.lastRunStatus] : "Paused"}
                    </Text>
                  </View>
                  <Text className="text-xs text-foreground-muted">
                    {ROUTINE_SCHEDULE_PRESETS.find((preset) => preset.value === routine.cron)
                      ?.label ?? routine.cron}{" "}
                    · {routine.timeZone}
                  </Text>
                  <Text className="text-xs text-foreground-muted">
                    {routine.enabled
                      ? `Next: ${routineTime(routine.nextRunAt)}`
                      : "Schedule paused"}
                  </Text>
                  {routine.lastError ? (
                    <Text className="text-xs text-danger" numberOfLines={2}>
                      {routine.lastError}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
              {routineEntries.length === 0 ? (
                <Text className="py-5 text-sm text-foreground-muted">
                  No routines on this environment yet.
                </Text>
              ) : filteredRoutines.length === 0 ? (
                <Text className="py-5 text-sm text-foreground-muted">
                  No routines match your search or filter.
                </Text>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <Action
              label="Back to routines"
              disabled={action !== null}
              onPress={() =>
                leaveDraft(() => {
                  setEditor(null);
                  setNotice(null);
                })
              }
            />
            <View className="gap-2 border-y border-border py-3">
              <Text className="text-xs text-foreground-muted">
                {editor.id ? "Saved routine" : "New routine"}
                {dirty ? " · Unsaved changes" : ""}
              </Text>
              <Text className="text-sm">
                Next:{" "}
                {savedRoutine?.enabled
                  ? routineTime(savedRoutine.nextRunAt)
                  : savedRoutine
                    ? "Paused"
                    : "After saving"}
              </Text>
              <Text className="text-sm">
                Last: {routineTime(savedRoutine?.lastRunAt ?? null)} ·{" "}
                {ROUTINE_RUN_LABELS[savedRoutine?.lastRunStatus ?? "never"]}
              </Text>
              {savedRoutine?.lastError ? (
                <Text accessibilityRole="alert" className="text-sm text-danger">
                  Last launch failed: {savedRoutine.lastError}
                </Text>
              ) : null}
            </View>
            <Field label="Name">
              <TextInput
                accessibilityLabel="Routine name"
                value={editor.draft.name}
                editable={action === null}
                onChangeText={(name) => changeDraft({ name })}
              />
            </Field>
            <Selector
              label="Project"
              value={editor.draft.projectId}
              options={projects.map((project) => ({ value: project.id, label: project.title }))}
              disabled={action !== null}
              onSelect={(value) => {
                const project = projects.find((item) => item.id === value);
                if (project) changeDraft({ projectId: project.id });
              }}
            />
            <Selector
              label="Provider subscription"
              value={editor.draft.modelSelection.instanceId}
              options={providers.map((provider) => ({
                value: provider.instanceId,
                label: `${provider.displayName ?? provider.instanceId}${provider.auth.email ? ` · ${provider.auth.email}` : ""}`,
              }))}
              disabled={action !== null}
              onSelect={(value) => {
                const provider = providers.find((item) => item.instanceId === value);
                if (provider)
                  changeDraft({
                    modelSelection: {
                      instanceId: provider.instanceId,
                      model:
                        provider.models.find((model) => model.isDefault)?.slug ??
                        provider.models[0]!.slug,
                    },
                  });
              }}
            />
            <Selector
              label="Model"
              value={editor.draft.modelSelection.model}
              options={(selectedProvider?.models ?? []).map((model) => ({
                value: model.slug,
                label: model.name,
              }))}
              disabled={action !== null}
              onSelect={(model) =>
                changeDraft({ modelSelection: { ...editor.draft.modelSelection, model } })
              }
            />
            <Selector
              label="Schedule"
              value={
                ROUTINE_SCHEDULE_PRESETS.some((preset) => preset.value === editor.draft.cron)
                  ? editor.draft.cron
                  : "custom"
              }
              options={[...ROUTINE_SCHEDULE_PRESETS, { value: "custom", label: "Custom cron" }]}
              disabled={action !== null}
              onSelect={(cron) => changeDraft({ cron: cron === "custom" ? "" : cron })}
            />
            {!ROUTINE_SCHEDULE_PRESETS.some((preset) => preset.value === editor.draft.cron) ? (
              <Field label="Custom cron">
                <TextInput
                  accessibilityLabel="Custom cron expression"
                  value={editor.draft.cron}
                  editable={action === null}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="0 7 * * *"
                  onChangeText={(cron) => changeDraft({ cron })}
                />
              </Field>
            ) : null}
            <Field label="Time zone">
              <TextInput
                accessibilityLabel="Routine time zone"
                value={editor.draft.timeZone}
                editable={action === null}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="America/Vancouver"
                onChangeText={(timeZone) => changeDraft({ timeZone })}
              />
            </Field>
            <View className="gap-2 border-y border-border py-3">
              <View className="flex-row items-center gap-3">
                <Text className="flex-1 text-sm">Catch up after coming online</Text>
                <Switch
                  accessibilityLabel="Catch up after coming online"
                  value={editor.draft.catchUp !== false}
                  disabled={action !== null}
                  onValueChange={(catchUp) => changeDraft({ catchUp })}
                />
              </View>
              <Text className="text-xs text-foreground-muted">
                When off, occurrences more than five minutes late are skipped. Run now remains
                available.
              </Text>
              <View className="mt-2 flex-row items-center gap-3">
                <Text className="flex-1 text-sm">Skip when a previous task is active</Text>
                <Switch
                  accessibilityLabel="Skip when a previous task is active"
                  value={editor.draft.overlapPolicy === "skip"}
                  disabled={action !== null || !overlapAvailable}
                  onValueChange={(skip) => changeDraft({ overlapPolicy: skip ? "skip" : "allow" })}
                />
              </View>
              <Text className="text-xs text-foreground-muted">
                {!overlapAvailable ? "Update this environment to enable overlap protection. " : ""}
                Checks retained tasks before scheduled and Run now launches. Skipped occurrences
                link to the active task. Unavailable activity is recorded as a skipped occurrence.
                Existing work continues.
              </Text>
              <Field label="Daily launch limit">
                <TextInput
                  accessibilityLabel="Daily launch limit"
                  value={editor.draft.dailyLaunchLimit?.toString() ?? ""}
                  editable={action === null && dailyLimitAvailable}
                  keyboardType="number-pad"
                  placeholder="No limit"
                  onChangeText={(value) =>
                    changeDraft({ dailyLaunchLimit: value === "" ? null : Number(value) })
                  }
                />
              </Field>
              <Text className="text-xs text-foreground-muted">
                {!dailyLimitAvailable
                  ? "Update this environment to enable daily launch limits. "
                  : ""}
                Scheduled and Run now attempts share this limit. Failed launches count; skipped
                occurrences do not. Resets at midnight in the routine time zone. This limits
                attempts, not spend. Leave blank to remove the limit.
              </Text>
              {savedRoutine?.dailyLaunchUsage ? (
                <Text className="text-xs text-foreground-muted">
                  Recorded {savedRoutine.dailyLaunchUsage.day} ·{" "}
                  {savedRoutine.dailyLaunchUsage.attempts} launch attempts
                  {" · "}
                  {savedRoutine.dailyLaunchUsage.timeZone}
                </Text>
              ) : (
                <Text className="text-xs text-foreground-muted">
                  No launch counter recorded yet; older launches are not reconstructed.
                </Text>
              )}
              <Text className="text-xs font-t3-medium">
                Next five occurrences · {editor.draft.timeZone}
              </Text>
              {schedulePreview.map((at) => (
                <Text key={at} className="text-xs text-foreground-muted">
                  {new Date(at).toLocaleString(undefined, {
                    timeZone: editor.draft.timeZone,
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZoneName: "short",
                  })}
                </Text>
              ))}
              <Text className="text-xs text-foreground-muted">
                Preview uses this device's clock. The environment schedules launches.
              </Text>
              {savedRoutine?.lastSkippedAt ? (
                <Text className="text-xs text-foreground-muted">
                  Last skipped: {routineTime(savedRoutine.lastSkippedAt)}
                </Text>
              ) : null}
            </View>
            <Selector
              label="Permission mode"
              value={editor.draft.runtimeMode}
              options={PERMISSION_OPTIONS}
              disabled={action !== null}
              onSelect={(value) => {
                const option = PERMISSION_OPTIONS.find((item) => item.value === value);
                if (option) changeDraft({ runtimeMode: option.value });
              }}
            />
            <Selector
              label="Interaction mode"
              value={editor.draft.interactionMode}
              options={INTERACTION_OPTIONS}
              disabled={action !== null}
              onSelect={(value) => {
                const option = INTERACTION_OPTIONS.find((item) => item.value === value);
                if (option) changeDraft({ interactionMode: option.value });
              }}
            />
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-t3-medium">Enabled</Text>
              <Switch
                accessibilityLabel="Routine enabled"
                value={editor.draft.enabled}
                disabled={action !== null}
                onValueChange={(enabled) => changeDraft({ enabled })}
              />
            </View>
            <Field label="Prompt">
              <View className="gap-2">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerClassName="gap-2 py-1"
                >
                  {ROUTINE_PROMPT_TEMPLATES.map((tmpl) => (
                    <Pressable
                      key={tmpl.label}
                      accessibilityRole="button"
                      accessibilityLabel={`Use template ${tmpl.label}`}
                      disabled={action !== null}
                      onPress={() => {
                        changeDraft({
                          name:
                            editor.draft.name === "Daily routine" || !editor.draft.name
                              ? tmpl.label
                              : editor.draft.name,
                          prompt: tmpl.prompt,
                        });
                      }}
                      className="rounded-lg border border-border bg-subtle px-2.5 py-1.5 active:bg-subtle/80"
                    >
                      <Text className="text-xs font-t3-medium text-foreground">{tmpl.label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <TextInput
                  accessibilityLabel="Routine prompt"
                  value={editor.draft.prompt}
                  editable={action === null}
                  multiline
                  textAlignVertical="top"
                  className="min-h-40"
                  onChangeText={(prompt) => changeDraft({ prompt })}
                />
              </View>
            </Field>
            {issue ? (
              <Text accessibilityRole="alert" className="text-sm text-warning">
                {issue}
              </Text>
            ) : null}
            {editor.id !== null && !savedRoutine ? (
              <Text accessibilityRole="alert" className="text-sm text-warning">
                This routine is no longer present on this environment. Duplicate it to save a new
                routine.
              </Text>
            ) : null}
            {configurationChanged && savedRoutine ? (
              <View className="gap-2 border-l-2 border-warning px-3 py-2">
                <Text accessibilityRole="alert" className="text-sm text-warning">
                  This routine changed on another device. Review the saved version before saving or
                  running it. Your draft is still here.
                </Text>
                <Action
                  label="Review saved version"
                  disabled={action !== null}
                  onPress={() =>
                    leaveDraft(() => {
                      setEditor({ id: editor.id, draft: savedRoutine, baseline: savedRoutine });
                      setNotice(null);
                    })
                  }
                />
              </View>
            ) : null}
            <Action
              label="Export template"
              disabled={action !== null}
              onPress={() => {
                try {
                  const message = serializeRoutineTemplate(editor.draft);
                  void Share.share({
                    title: `${editor.draft.name} routine template`,
                    message,
                  }).catch(() =>
                    setNotice({ error: true, text: "Could not share template. Try again." }),
                  );
                } catch (error) {
                  setNotice({
                    error: true,
                    text: error instanceof Error ? error.message : "Could not export template.",
                  });
                }
              }}
            />
            <Action
              label={action === "save" ? "Saving…" : "Save routine"}
              disabled={disabled || issue !== null || (editor.id !== null && !savedRoutine)}
              onPress={save}
              primary
            />
            {savedRoutine && editor.id ? (
              <>
                {dirty ? (
                  <Text className="text-xs text-foreground-muted">
                    Save your changes before running, pausing or deleting this routine.
                  </Text>
                ) : null}
                <View className="flex-row flex-wrap gap-2">
                  <Action
                    label={action === "run" ? "Queueing…" : "Run now"}
                    disabled={
                      persistedActionDisabled ||
                      issue !== null ||
                      savedRoutine.lastRunStatus === "running"
                    }
                    onPress={() =>
                      void writeRoutine(
                        editor.id!,
                        { _tag: "RoutineAction", action: "run-now" },
                        "run",
                      )
                    }
                  />
                  <Action
                    label={savedRoutine.enabled ? "Pause" : "Resume"}
                    disabled={persistedActionDisabled}
                    onPress={() =>
                      void writeRoutine(
                        editor.id!,
                        {
                          _tag: "RoutineAction",
                          action: savedRoutine.enabled ? "pause" : "resume",
                        },
                        savedRoutine.enabled ? "pause" : "resume",
                      )
                    }
                  />
                  {savedRoutine.lastThreadId ? (
                    <Action
                      label="Open last task"
                      disabled={action !== null}
                      onPress={openLastTask}
                    />
                  ) : null}
                  <Action
                    label="Duplicate"
                    disabled={action !== null}
                    onPress={() => {
                      setEditor({
                        id: null,
                        draft: duplicateRoutine(editor.draft),
                        baseline: null,
                      });
                      setNotice(null);
                    }}
                  />
                  <Action
                    label={action === "delete" ? "Deleting…" : "Delete"}
                    disabled={persistedActionDisabled}
                    danger
                    onPress={() =>
                      Alert.alert(
                        "Delete routine?",
                        "Its existing tasks will stay in project history.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Delete",
                            style: "destructive",
                            onPress: () => void writeRoutine(editor.id!, null, "delete"),
                          },
                        ],
                      )
                    }
                  />
                </View>
                {!savedRoutine.enabled ? (
                  <Text className="text-xs text-foreground-muted">
                    Run now also resumes this routine's recurring schedule.
                  </Text>
                ) : null}
              </>
            ) : editor.id ? (
              <Action
                label="Duplicate as new routine"
                disabled={action !== null}
                onPress={() => {
                  setEditor({ id: null, draft: duplicateRoutine(editor.draft), baseline: null });
                  setNotice(null);
                }}
              />
            ) : null}
            {savedRoutine && editor.id && environmentId ? (
              <RoutineRunHistory
                key={`${environmentId}:${editor.id}`}
                routine={savedRoutine}
                routineId={editor.id}
                environmentId={environmentId}
                onOpenThread={openTask}
              />
            ) : null}
            <Text className="border-t border-border pt-3 text-xs leading-normal text-foreground-muted">
              The environment's T3 server must be running. A missed occurrence runs once after it
              returns. Every occurrence creates a task; “Launched” confirms creation, not
              completion.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-t3-medium">{label}</Text>
      {children}
    </View>
  );
}

function Selector(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly disabled: boolean;
  readonly onSelect: (value: string) => void;
}) {
  const selected = props.options.find((option) => option.value === props.value);
  const label =
    selected?.label ?? (props.value ? `Unavailable · ${props.value}` : "None available");
  return (
    <Field label={props.label}>
      <ControlPillMenu
        title={props.label}
        accessibilityLabel={`${props.label}: ${label}`}
        actions={props.options.map((option) => ({
          id: option.value,
          title: option.label,
          state: option.value === props.value ? ("on" as const) : ("off" as const),
          attributes: { disabled: props.disabled },
        }))}
        onPressAction={({ nativeEvent }) => {
          if (!props.disabled) props.onSelect(nativeEvent.event);
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.label}: ${label}`}
          accessibilityState={{ disabled: props.disabled || props.options.length === 0 }}
          disabled={props.disabled || props.options.length === 0}
          className={cn(
            "min-h-12 flex-row items-center gap-2 border-b border-border py-3",
            props.disabled && "opacity-50",
          )}
        >
          <Text className="min-w-0 flex-1 text-sm" numberOfLines={2}>
            {label}
          </Text>
          <Text className="text-foreground-muted">⌄</Text>
        </Pressable>
      </ControlPillMenu>
    </Field>
  );
}

function Action(props: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly primary?: boolean;
  readonly danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "min-h-11 items-center justify-center rounded-lg border border-border px-4 py-3",
        props.primary ? "bg-primary" : "bg-subtle",
        props.disabled && "opacity-45",
      )}
    >
      <Text
        className={cn(
          "text-sm font-t3-medium",
          props.primary
            ? "text-primary-foreground"
            : props.danger
              ? "text-danger"
              : "text-foreground",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
