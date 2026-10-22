/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=1m; seat=codex; date=2026-10-18 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=125m; seat=codex; date=2026-10-14 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=9m; seat=codex; date=2026-10-10 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=29m; seat=codex; date=2026-10-09 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=30m; seat=codex; date=2026-10-08 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=35m; seat=codex; date=2026-10-02 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=3m; seat=antigravity; date=2026-10-01 */
import {
  MAX_ROUTINE_RUN_HISTORY,
  RoutineTemplate,
  type ProviderInstanceId,
  type RoutineDefinition,
  type RoutineRunReceipt,
  type RoutineTurnOutcome,
  type RoutineClientMutation,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { sameRoutineConfiguration, routineScheduleIssue } from "@t3tools/shared/routines";

export const ROUTINE_SCHEDULE_PRESETS = [
  { value: "0 * * * *", label: "Hourly" },
  { value: "0 7 * * *", label: "Daily at 7:00 AM" },
  { value: "0 9 * * 1-5", label: "Weekdays at 9:00 AM" },
  { value: "0 9 * * 1", label: "Weekly on Monday" },
  { value: "0 9 1 * *", label: "Monthly on the 1st" },
] as const;

export const ROUTINE_PROMPT_TEMPLATES = [
  {
    label: "Daily Task",
    prompt:
      "Review the project linear issues or roadmap, pick the highest-priority scoped task, and implement it with complete tests and documentation.",
  },
  {
    label: "Health & Security",
    prompt:
      "Run the test suite, audit dependencies for known vulnerabilities, inspect code quality/linting, and report any discovered regressions.",
  },
  {
    label: "24h Digest",
    prompt:
      "Analyze repository commits, open PRs, and active agent threads from the last 24 hours. Summarize progress, blockers, and next milestones.",
  },
  {
    label: "Code Cleanup",
    prompt:
      "Inspect the codebase for dead code, unused imports, outdated comments, or complex functions that can be cleanly refactored without breaking behavior.",
  },
] as const;

export const ROUTINE_RUN_LABELS = {
  never: "Not run",
  running: "Starting",
  launched: "Launched",
  failed: "Failed",
} as const;

/** One exact, reviewable batch. The server resolves every entry under its settings lock. */
export function makeRoutineBulkAction(
  entries: ReadonlyArray<readonly [string, RoutineDefinition]>,
  action: "pause" | "resume",
) {
  const selected = entries.filter(([, routine]) => routine.enabled === (action === "pause"));
  if (selected.length > 100) throw new Error("Narrow the filter to at most 100 routine schedules.");
  const routines: Record<string, RoutineClientMutation> = {};
  for (const [id, routine] of selected) {
    const {
      name,
      enabled,
      cron,
      timeZone,
      projectId,
      prompt,
      modelSelection,
      runtimeMode,
      interactionMode,
      catchUp,
      overlapPolicy,
      dailyLaunchLimit,
    } = routine;
    routines[id] = {
      _tag: "RoutineAction",
      action,
      expected: {
        name,
        enabled,
        cron,
        timeZone,
        projectId,
        prompt,
        modelSelection,
        runtimeMode,
        interactionMode,
        ...(catchUp === undefined ? {} : { catchUp }),
        ...(overlapPolicy === undefined ? {} : { overlapPolicy }),
        ...(dailyLaunchLimit === undefined ? {} : { dailyLaunchLimit }),
      },
    };
  }
  return {
    action,
    routines,
    names: selected.map(([, routine]) => routine.name),
    count: selected.length,
  };
}

export const ROUTINE_HISTORY_LABELS = {
  running: "Starting",
  launched: "Launched",
  failed: "Failed",
  skipped: "Skipped",
} as const;
export const ROUTINE_SKIP_LABELS = {
  missed: "Missed occurrence",
  overlap: "Previous task still active",
  "activity-unavailable": "Task activity could not be checked",
  "daily-limit": "Daily launch limit reached",
} as const;
export type RoutineHistoryFilter = "all" | RoutineRunReceipt["status"];
export const ROUTINE_OUTCOME_LABELS = {
  completed: "Turn completed",
  interrupted: "Turn interrupted",
  failed: "Turn failed",
  unknown: "Outcome not attributable",
} as const;
export type RoutineOutcomeFilter = "all" | "unrecorded" | RoutineTurnOutcome["status"];

export function routineOutcomeLabel(receipt: RoutineRunReceipt): string {
  return receipt.outcome
    ? ROUTINE_OUTCOME_LABELS[receipt.outcome.status]
    : receipt.launchSequence === undefined
      ? "Launch-only receipt"
      : "Turn outcome not recorded yet";
}

export function selectRoutineRuns(
  routine: RoutineDefinition,
  filter: RoutineHistoryFilter,
  outcome: RoutineOutcomeFilter = "all",
  query = "",
) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (routine.runHistory ?? []).filter(
    (receipt) =>
      (filter === "all" || receipt.status === filter) &&
      (outcome === "all" ||
        (outcome === "unrecorded" ? !receipt.outcome : receipt.outcome?.status === outcome)) &&
      terms.every((term) =>
        [
          receipt.id,
          receipt.scheduledAt,
          receipt.threadId,
          receipt.projectId,
          receipt.modelSelection.instanceId,
          receipt.modelSelection.model,
          receipt.error,
          receipt.skipReason ? ROUTINE_SKIP_LABELS[receipt.skipReason] : "",
          routineOutcomeLabel(receipt),
          receipt.outcome?.reason,
        ].some((value) => value?.toLowerCase().includes(term)),
      ),
  );
}

export function makeRoutineHistoryReport(input: {
  readonly routine: RoutineDefinition;
  readonly routineId: string;
  readonly environmentId: string;
  readonly exportedAt: string;
  readonly filter?: RoutineHistoryFilter;
  readonly outcome?: RoutineOutcomeFilter;
  readonly query?: string;
}) {
  const filter = input.filter ?? "all";
  const outcome = input.outcome ?? "all";
  const query = input.query?.trim() ?? "";
  const receipts = selectRoutineRuns(input.routine, filter, outcome, query);
  return {
    format: "t3.routine-history/1" as const,
    exportedAt: input.exportedAt,
    environmentId: input.environmentId,
    routineId: input.routineId,
    routineName: input.routine.name,
    retainedLimit: MAX_ROUTINE_RUN_HISTORY,
    retainedCount: input.routine.runHistory?.length ?? 0,
    matchingCount: receipts.length,
    selection: { launch: filter, outcome, query },
    scope:
      "Retained scheduler occurrence receipts, newest first. Launch acknowledgement and first-turn outcome are separate. Outcomes quote durable session events and do not verify the task's correctness. Older launch-only receipts are not reconstructed.",
    receipts,
  };
}

export type RoutineStatusFilter = "all" | "active" | "paused" | "failed";

export function selectRoutines(
  routines: Readonly<Record<string, RoutineDefinition>>,
  options: { readonly status: RoutineStatusFilter; readonly query?: string },
): [string, RoutineDefinition][] {
  const query = options.query?.trim().toLowerCase() ?? "";
  return Object.entries(routines)
    .filter(([, routine]) => {
      if (options.status === "active" && (!routine.enabled || routine.lastRunStatus === "failed"))
        return false;
      if (options.status === "paused" && routine.enabled) return false;
      if (options.status === "failed" && routine.lastRunStatus !== "failed") return false;
      return (
        !query ||
        [routine.name, routine.prompt, routine.cron, routine.projectId].some((value) =>
          value.toLowerCase().includes(query),
        )
      );
    })
    .sort(
      ([leftId, left], [rightId, right]) =>
        left.name.localeCompare(right.name) || leftId.localeCompare(rightId),
    );
}

export function createRoutineDraft(input: {
  readonly projectId: RoutineDefinition["projectId"] | undefined;
  readonly instanceId: ProviderInstanceId | undefined;
  readonly model: string | undefined;
  readonly timeZone?: string;
  readonly overlapProtectionAvailable?: boolean;
}): RoutineDefinition | null {
  if (!input.projectId || !input.instanceId || !input.model) return null;
  return {
    name: "Daily routine",
    enabled: true,
    overlapPolicy: input.overlapProtectionAvailable === false ? "allow" : "skip",
    cron: "0 7 * * *",
    timeZone: input.timeZone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
    projectId: input.projectId,
    prompt: "Review this project and complete the next clearly scoped priority.",
    modelSelection: { instanceId: input.instanceId, model: input.model },
    runtimeMode: "full-access",
    interactionMode: "default",
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: "never",
    lastThreadId: null,
    lastError: null,
  };
}

function resetRoutineHistory(routine: RoutineDefinition): RoutineDefinition {
  const {
    lastSkippedAt: _skippedAt,
    runHistory: _history,
    dailyLaunchUsage: _usage,
    ...configuration
  } = routine;
  return {
    ...configuration,
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: "never",
    lastThreadId: null,
    lastError: null,
  };
}

export function duplicateRoutine(routine: RoutineDefinition): RoutineDefinition {
  return resetRoutineHistory({ ...routine, name: `${routine.name} copy` });
}

export function routineDraftIsDirty(
  draft: RoutineDefinition,
  current: RoutineDefinition | undefined,
): boolean {
  if (!current) return true;
  return !sameRoutineConfiguration(draft, current);
}

/** Keep scheduler-owned launch state when an editor saves an older configuration draft. */
export function routineForSave(
  draft: RoutineDefinition,
  current: RoutineDefinition | undefined,
): RoutineDefinition {
  if (!current) return resetRoutineHistory(draft);
  const scheduleChanged =
    current.cron !== draft.cron ||
    current.timeZone !== draft.timeZone ||
    current.enabled !== draft.enabled;
  const { runHistory: _draftHistory, dailyLaunchUsage: _draftUsage, ...configuration } = draft;
  return {
    ...configuration,
    ...(current.runHistory ? { runHistory: current.runHistory } : {}),
    ...(current.dailyLaunchUsage ? { dailyLaunchUsage: current.dailyLaunchUsage } : {}),
    nextRunAt: scheduleChanged ? null : current.nextRunAt,
    lastRunAt: current.lastRunAt,
    lastRunStatus: current.lastRunStatus,
    lastThreadId: current.lastThreadId,
    lastError: current.lastError,
    ...(current.lastSkippedAt ? { lastSkippedAt: current.lastSkippedAt } : {}),
  };
}

export function setRoutineEnabled(routine: RoutineDefinition, enabled: boolean): RoutineDefinition {
  return { ...routine, enabled, nextRunAt: null };
}

/** The next scheduler sweep launches this occurrence; paused routines resume as on web. */
export function queueRoutineNow(routine: RoutineDefinition, now: number): RoutineDefinition {
  return {
    ...routine,
    enabled: true,
    nextRunAt: DateTime.formatIso(DateTime.makeUnsafe(now - 1_000)),
    lastRunStatus: "never",
    lastError: null,
  };
}

export function routineDraftIssue(
  routine: RoutineDefinition,
  availability: {
    readonly projectAvailable: boolean;
    readonly providerAvailable: boolean;
    readonly modelAvailable: boolean;
    readonly overlapProtectionAvailable?: boolean;
    readonly dailyLaunchLimitAvailable?: boolean;
  },
  precomputedScheduleIssue?: string | null,
): string | null {
  if (!availability.projectAvailable) return "Choose an available project.";
  if (!availability.providerAvailable) return "Choose an active provider subscription.";
  if (!availability.modelAvailable) return "Choose an available model.";
  if (routine.overlapPolicy === "skip" && availability.overlapProtectionAvailable === false)
    return "Update the connected environment to use overlap protection.";
  if (routine.dailyLaunchLimit != null) {
    if (availability.dailyLaunchLimitAvailable === false)
      return "Update the connected environment to use daily launch limits.";
    if (
      !Number.isInteger(routine.dailyLaunchLimit) ||
      routine.dailyLaunchLimit < 1 ||
      routine.dailyLaunchLimit > 1000
    )
      return "Enter a whole-number daily limit from 1 to 1,000, or leave it blank for no limit.";
  }
  if (!routine.name.trim()) return "Enter a routine name.";
  if (!routine.prompt.trim()) return "Enter a prompt for the agent.";
  return precomputedScheduleIssue === undefined
    ? routineScheduleIssue(routine.cron, routine.timeZone)
    : precomputedScheduleIssue;
}

const MAX_ROUTINE_TEMPLATE_BYTES = 128 * 1024;
const decodeRoutineTemplate = Schema.decodeUnknownSync(RoutineTemplate);

/** Explicit allowlist: no environment identities, model options, usage or receipts. */
export function serializeRoutineTemplate(routine: RoutineDefinition): string {
  const template: RoutineTemplate = {
    format: "t3.routine-template/1",
    name: routine.name,
    prompt: routine.prompt,
    cron: routine.cron,
    timeZone: routine.timeZone,
    runtimeMode: routine.runtimeMode,
    interactionMode: routine.interactionMode,
    suggestedModel: routine.modelSelection.model,
    ...(routine.catchUp === undefined ? {} : { catchUp: routine.catchUp }),
    ...(routine.overlapPolicy === undefined ? {} : { overlapPolicy: routine.overlapPolicy }),
    ...(routine.dailyLaunchLimit === undefined
      ? {}
      : { dailyLaunchLimit: routine.dailyLaunchLimit }),
  };
  const text = JSON.stringify(template, null, 2);
  parseRoutineTemplate(text);
  return text;
}

export function parseRoutineTemplate(text: string): RoutineTemplate {
  if (new TextEncoder().encode(text).byteLength > MAX_ROUTINE_TEMPLATE_BYTES) {
    throw new Error("Routine templates must be 128 KB or smaller.");
  }
  let template: RoutineTemplate;
  try {
    template = decodeRoutineTemplate(JSON.parse(text));
  } catch {
    throw new Error(
      "Paste a valid t3.routine-template/1 JSON template with configuration fields only.",
    );
  }
  const issue = routineScheduleIssue(template.cron, template.timeZone);
  if (issue) throw new Error(issue);
  return template;
}

/** Import is a new paused draft, bound to this environment's selected defaults. */
export function importRoutineTemplate(
  text: string,
  localDraft: RoutineDefinition,
): RoutineDefinition {
  const { format: _format, suggestedModel: _model, ...configuration } = parseRoutineTemplate(text);
  const {
    catchUp: _catchUp,
    overlapPolicy: _overlapPolicy,
    dailyLaunchLimit: _dailyLaunchLimit,
    ...localConfiguration
  } = resetRoutineHistory(localDraft);
  return {
    ...localConfiguration,
    ...configuration,
    enabled: false,
    modelSelection: localDraft.modelSelection,
    projectId: localDraft.projectId,
  };
}
