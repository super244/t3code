/* agent-watermark: model=opus-5.5; effort=high; duration=3m; seat=claude-code; date=2026-10-19 */
import type {
  ModelSelection,
  SelectProviderOptionDescriptor,
  ServerProvider,
} from "@t3tools/contracts";

import { getTriggerDisplayModelLabel } from "../chat/providerIconUtils";

export function raceProviderLabel(
  provider: Pick<ServerProvider, "displayName" | "instanceId">,
): string {
  return provider.displayName?.trim() || provider.instanceId;
}

export function raceModelLabel(provider: ServerProvider | undefined, slug: string): string {
  const model = provider?.models.find((item) => item.slug === slug);
  return model ? getTriggerDisplayModelLabel(model) : slug;
}

/** The model's reasoning-effort setting, when it has one. */
export function raceEffortDescriptor(
  provider: ServerProvider | null | undefined,
  modelSlug: string,
): SelectProviderOptionDescriptor | null {
  const model = provider?.models.find((item) => item.slug === modelSlug);
  const descriptor = model?.capabilities?.optionDescriptors?.find(
    (item): item is SelectProviderOptionDescriptor =>
      item.type === "select" && /effort|reasoning/i.test(`${item.id} ${item.label}`),
  );
  return descriptor ?? null;
}

/** The effort a selection runs with, as a choice id; null when it sets none. */
export function raceSelectionEffort(
  provider: ServerProvider | null | undefined,
  selection: { readonly model: string; readonly options?: ModelSelection["options"] | undefined },
): string | null {
  const descriptor = raceEffortDescriptor(provider, selection.model);
  if (!descriptor) return null;
  const value = selection.options?.find((option) => option.id === descriptor.id)?.value;
  return typeof value === "string" ? value : null;
}

export function raceEffortLabel(
  provider: ServerProvider | null | undefined,
  modelSlug: string,
  effort: string | null,
): string | null {
  if (!effort) return null;
  const descriptor = raceEffortDescriptor(provider, modelSlug);
  return descriptor?.options.find((choice) => choice.id === effort)?.label ?? effort;
}

/**
 * "Codex GPT-6.1-Sol", or just "Claude Haiku 5.5" when the model already names
 * its provider; "· High" when it runs with a chosen reasoning effort.
 */
export function formatRaceAgentLabel(
  provider: ServerProvider | null | undefined,
  selection: {
    readonly instanceId: string;
    readonly model: string;
    readonly options?: ModelSelection["options"] | undefined;
  },
): string {
  const providerLabel = provider ? raceProviderLabel(provider) : selection.instanceId;
  const modelLabel = raceModelLabel(provider ?? undefined, selection.model);
  const base = modelLabel.toLowerCase().startsWith(providerLabel.toLowerCase())
    ? modelLabel
    : `${providerLabel} ${modelLabel}`;
  const effort = raceEffortLabel(provider, selection.model, raceSelectionEffort(provider, selection));
  return effort ? `${base} · ${effort}` : base;
}
