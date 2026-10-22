/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=125m; seat=codex; date=2026-10-14 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=15m; seat=codex; date=2026-10-10 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=29m; seat=codex; date=2026-10-09 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=30m; seat=codex; date=2026-10-08 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=35m; seat=codex; date=2026-10-02 */
import {
  isProviderDriverKind,
  isProviderAvailable,
  resolveProviderInstanceEnabled,
  type ModelSelection,
  type ProjectId,
  type ProviderDriverKind,
  type ServerProvider,
  ServerSettings,
  type ServerSettingsPatch,
  type ServerSettingsClientPatch,
  type RoutineDefinition,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";
import { createModelSelection } from "./model.ts";
import { sameRoutineConfiguration, routineScheduleIssue } from "./routines.ts";
import {
  getBackgroundActivityBaseProfile,
  normalizeBackgroundActivitySettings,
  normalizeServerBackgroundActivitySettings,
  resolveBackgroundActivitySettings,
} from "./backgroundActivitySettings.ts";

const ServerSettingsJson = fromLenientJson(ServerSettings);
const decodeServerSettingsJson = Schema.decodeUnknownOption(ServerSettingsJson);

export function resolveProjectAgentBrowserAccess(
  settings: Pick<ServerSettings, "enableAgentBrowserAccess" | "projectAgentBrowserAccessOverrides">,
  projectId: ProjectId,
): boolean {
  return (
    settings.projectAgentBrowserAccessOverrides[projectId] ?? settings.enableAgentBrowserAccess
  );
}

export function resolveProjectAutoPull(
  settings: Pick<ServerSettings, "defaultAutoPull" | "projectAutoPullOverrides">,
  projectId: ProjectId,
  legacyAutoPull: boolean | undefined,
): boolean {
  // Existing opt-ins stay enabled until explicitly overridden or reset.
  return (
    settings.projectAutoPullOverrides[projectId] ??
    (legacyAutoPull === true || settings.defaultAutoPull)
  );
}

type LegacyProviderSettings = ServerSettings["providers"][keyof ServerSettings["providers"]];

const getLegacyProviderSettings = (
  settings: ServerSettings,
  provider: ProviderDriverKind,
): LegacyProviderSettings | undefined =>
  (settings.providers as Record<string, LegacyProviderSettings | undefined>)[provider];

export function isModelSelectionProviderEnabled(
  settings: ServerSettings,
  selection: ModelSelection,
): boolean {
  const instanceConfig = settings.providerInstances[selection.instanceId];
  if (instanceConfig !== undefined) {
    return resolveProviderInstanceEnabled(instanceConfig);
  }

  return (
    isProviderDriverKind(selection.instanceId) &&
    getLegacyProviderSettings(settings, selection.instanceId)?.enabled === true
  );
}

export function resolveSourceControlWriterModelSelection(
  settings: ServerSettings,
  providers?: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const selection = settings.sourceControlWriterModelSelection;
  if (!selection || !isModelSelectionProviderEnabled(settings, selection)) {
    return settings.textGenerationModelSelection;
  }
  if (providers === undefined) {
    return selection;
  }

  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  return provider?.enabled === true && isProviderAvailable(provider)
    ? selection
    : settings.textGenerationModelSelection;
}

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  const decoded = decodeServerSettingsJson(raw);
  if (Option.isSome(decoded)) {
    return extractPersistedServerObservabilitySettings(decoded.value);
  }
  return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
}

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(patch && (patch.instanceId !== undefined || patch.model !== undefined));
}

function mergeModelSelectionOptionsById(input: {
  current: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
  patch: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
}): Array<{ id: string; value: string | boolean }> | undefined {
  if (input.patch === undefined) {
    return input.current ? [...input.current] : undefined;
  }
  if (input.patch.length === 0) {
    return undefined;
  }

  const merged = new Map((input.current ?? []).map((selection) => [selection.id, selection.value]));
  for (const selection of input.patch) {
    merged.set(selection.id, selection.value);
  }
  return [...merged.entries()].map(([id, value]) => ({ id, value }));
}

/** Upsert each patched entry; `null` removes it. Entries the patch omits are untouched. */
function mergeSettingsEntries<Value>(
  current: Readonly<Record<string, Value>>,
  patch: Readonly<Record<string, Value | null>>,
): Record<string, Value> {
  const next = new Map(Object.entries(current));
  for (const [id, config] of Object.entries(patch)) {
    if (config === null) {
      next.delete(id);
    } else {
      next.set(id, config);
    }
  }
  return Object.fromEntries(next);
}

/** Resolve wire mutations under the settings lock, retaining scheduler-owned history. */
export function resolveClientSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsClientPatch,
  now: number,
): ServerSettingsPatch {
  const { routines, ...rest } = patch;
  if (routines === undefined) return rest;
  const resolved: Record<string, RoutineDefinition | null> = {};
  for (const [id, mutation] of Object.entries(routines)) {
    if (mutation === null) {
      resolved[id] = null;
      continue;
    }
    const previous = current.routines[id];
    // Old clients encoded Run now by overwriting runtime fields. Reject that
    // ambiguous request rather than acknowledge a launch that was never queued.
    if (
      !("_tag" in mutation) &&
      previous &&
      mutation.lastRunStatus === "never" &&
      mutation.nextRunAt !== null &&
      mutation.nextRunAt !== previous.nextRunAt
    ) {
      throw new Error(
        "Update this client to run routines. Run requests now use the server's current configuration.",
      );
    }
    if ("_tag" in mutation && !previous) {
      throw new Error(
        "This routine was removed on another device. Duplicate it to create a new routine.",
      );
    }
    if (
      "_tag" in mutation &&
      mutation._tag === "RoutineEdit" &&
      previous &&
      !sameRoutineConfiguration(previous, mutation.expected) &&
      !sameRoutineConfiguration(previous, mutation.routine)
    ) {
      throw new Error(
        "This routine changed on another device. Review the saved version before saving. Your draft is still here.",
      );
    }
    if ("_tag" in mutation && mutation._tag === "RoutineAction") {
      // The assertion follows the missing-entry check above, including for deleted routines.
      const routine = previous!;
      if (mutation.expected && !sameRoutineConfiguration(routine, mutation.expected)) {
        throw new Error(
          "A selected routine changed on another device. Refresh and review the batch again; nothing was changed.",
        );
      }
      if (mutation.action === "run-now") {
        const issue = routineScheduleIssue(routine.cron, routine.timeZone);
        if (issue !== null) throw new Error(issue);
        if (routine.lastRunStatus === "running")
          throw new Error(
            "This routine is already starting. Wait for its task before running it again.",
          );
        resolved[id] = {
          ...routine,
          enabled: true,
          nextRunAt: DateTime.formatIso(DateTime.makeUnsafe(now - 1_000)),
          lastRunStatus: "never",
          lastError: null,
        };
      } else {
        const enabled = mutation.action === "resume";
        resolved[id] = {
          ...routine,
          enabled,
          nextRunAt: enabled === routine.enabled ? routine.nextRunAt : null,
        };
      }
      continue;
    }
    const rawDraft = "_tag" in mutation ? mutation.routine : mutation;
    const {
      lastSkippedAt: _clientSkippedAt,
      runHistory: _clientHistory,
      dailyLaunchUsage: _clientUsage,
      ...draft
    } = rawDraft;
    resolved[id] = {
      ...draft,
      overlapPolicy: draft.overlapPolicy ?? previous?.overlapPolicy ?? "allow",
      nextRunAt:
        previous &&
        previous.cron === draft.cron &&
        previous.timeZone === draft.timeZone &&
        previous.enabled === draft.enabled
          ? previous.nextRunAt
          : null,
      lastRunAt: previous?.lastRunAt ?? null,
      lastRunStatus: previous?.lastRunStatus ?? "never",
      lastThreadId: previous?.lastThreadId ?? null,
      lastError: previous?.lastError ?? null,
      ...(previous?.lastSkippedAt ? { lastSkippedAt: previous.lastSkippedAt } : {}),
      ...(previous?.runHistory ? { runHistory: previous.runHistory } : {}),
      ...(previous?.dailyLaunchUsage ? { dailyLaunchUsage: previous.dailyLaunchUsage } : {}),
    };
  }
  return { ...rest, routines: resolved };
}

export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const {
    automaticGitFetchInterval,
    providerHealthRefreshInterval,
    backgroundActivityProfile,
    backgroundActivity,
    // Merged per entry below; its `null` removals must not reach deepMerge.
    usageLimitSources: usageLimitSourcesPatch,
    usagePriceOverrides: usagePriceOverridesPatch,
    routines: routinesPatch,
    projectAgentBrowserAccessOverrides: projectAgentBrowserAccessOverridesPatch,
    projectAutoPullOverrides: projectAutoPullOverridesPatch,
    ...patchForMerge
  } = patch;
  const currentBackgroundActivity = normalizeServerBackgroundActivitySettings(current);
  const backgroundActivityPatch =
    backgroundActivityProfile !== undefined
      ? {
          schemaVersion: 1 as const,
          profile:
            automaticGitFetchInterval !== undefined || providerHealthRefreshInterval !== undefined
              ? ("custom" as const)
              : backgroundActivityProfile,
          ...(automaticGitFetchInterval !== undefined || providerHealthRefreshInterval !== undefined
            ? { baseProfile: backgroundActivityProfile }
            : {}),
          overrides: {
            ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
            ...(providerHealthRefreshInterval !== undefined
              ? { providerHealthRefreshInterval }
              : {}),
          },
        }
      : automaticGitFetchInterval !== undefined || providerHealthRefreshInterval !== undefined
        ? {
            schemaVersion: 1 as const,
            profile: "custom" as const,
            baseProfile: getBackgroundActivityBaseProfile(currentBackgroundActivity),
            overrides: {
              ...(currentBackgroundActivity.profile === "custom"
                ? currentBackgroundActivity.overrides
                : {}),
              ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
              ...(providerHealthRefreshInterval !== undefined
                ? { providerHealthRefreshInterval }
                : {}),
            },
          }
        : undefined;
  const next = deepMerge(current, patchForMerge);
  const nextWithReplacementsBase = {
    ...next,
    ...(backgroundActivity !== undefined
      ? {
          backgroundActivity: {
            ...deepMerge(currentBackgroundActivity, backgroundActivity),
            ...(backgroundActivity.overrides !== undefined
              ? { overrides: backgroundActivity.overrides }
              : {}),
          },
        }
      : { backgroundActivity: currentBackgroundActivity }),
    ...(backgroundActivity === undefined && backgroundActivityPatch !== undefined
      ? { backgroundActivity: backgroundActivityPatch }
      : {}),
    ...(patch.providerInstances !== undefined
      ? { providerInstances: patch.providerInstances }
      : {}),
    ...(projectAgentBrowserAccessOverridesPatch !== undefined
      ? {
          projectAgentBrowserAccessOverrides: mergeSettingsEntries(
            current.projectAgentBrowserAccessOverrides,
            projectAgentBrowserAccessOverridesPatch,
          ),
        }
      : {}),
    ...(projectAutoPullOverridesPatch !== undefined
      ? {
          projectAutoPullOverrides: mergeSettingsEntries(
            current.projectAutoPullOverrides,
            projectAutoPullOverridesPatch,
          ),
        }
      : {}),
    ...(patch.defaultModelSelection !== undefined
      ? { defaultModelSelection: patch.defaultModelSelection }
      : {}),
    ...(patch.defaultProjectScripts !== undefined
      ? { defaultProjectScripts: patch.defaultProjectScripts }
      : {}),
    ...(patch.projectScriptOverrides !== undefined
      ? {
          projectScriptOverrides: {
            ...current.projectScriptOverrides,
            ...patch.projectScriptOverrides,
          },
        }
      : {}),
    ...(usageLimitSourcesPatch !== undefined
      ? {
          usageLimitSources: mergeSettingsEntries(
            current.usageLimitSources,
            usageLimitSourcesPatch,
          ),
        }
      : {}),
    ...(usagePriceOverridesPatch !== undefined
      ? {
          usagePriceOverrides: mergeSettingsEntries(
            current.usagePriceOverrides,
            usagePriceOverridesPatch,
          ),
        }
      : {}),
    ...(routinesPatch !== undefined
      ? { routines: mergeSettingsEntries(current.routines, routinesPatch) }
      : {}),
    ...(patch.sourceControlWriterModelSelection !== undefined
      ? { sourceControlWriterModelSelection: patch.sourceControlWriterModelSelection }
      : {}),
    ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
    ...(providerHealthRefreshInterval !== undefined ? { providerHealthRefreshInterval } : {}),
  };
  const normalizedBackgroundActivity = normalizeBackgroundActivitySettings(
    nextWithReplacementsBase.backgroundActivity,
  );
  const resolvedBackgroundActivity = resolveBackgroundActivitySettings(
    normalizedBackgroundActivity,
  );
  const nextWithReplacements = {
    ...nextWithReplacementsBase,
    backgroundActivity: normalizedBackgroundActivity,
    automaticGitFetchInterval: resolvedBackgroundActivity.automaticGitFetchInterval,
    providerHealthRefreshInterval: resolvedBackgroundActivity.providerHealthRefreshInterval,
    backgroundActivityProfile: resolvedBackgroundActivity.profile,
  };
  if (!selectionPatch) {
    return nextWithReplacements;
  }

  const instanceId = selectionPatch.instanceId ?? current.textGenerationModelSelection.instanceId;
  const model = selectionPatch.model ?? current.textGenerationModelSelection.model;
  const options = shouldReplaceTextGenerationModelSelection(selectionPatch)
    ? selectionPatch.options
    : mergeModelSelectionOptionsById({
        current: current.textGenerationModelSelection.options,
        patch: selectionPatch.options,
      });

  return {
    ...nextWithReplacements,
    textGenerationModelSelection: createModelSelection(instanceId, model, options),
  };
}
