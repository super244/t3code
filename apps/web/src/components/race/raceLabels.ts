/* agent-watermark: model=opus-5.5; effort=high; duration=3m; seat=claude-code; date=2026-10-19 */
import type { ServerProvider } from "@t3tools/contracts";

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

/** "Codex GPT-6.1-Sol", or just "Claude Haiku 5.5" when the model already names its provider. */
export function formatRaceAgentLabel(
  provider: ServerProvider | null | undefined,
  selection: { readonly instanceId: string; readonly model: string },
): string {
  const providerLabel = provider ? raceProviderLabel(provider) : selection.instanceId;
  const modelLabel = raceModelLabel(provider ?? undefined, selection.model);
  return modelLabel.toLowerCase().startsWith(providerLabel.toLowerCase())
    ? modelLabel
    : `${providerLabel} ${modelLabel}`;
}
