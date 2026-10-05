/* agent-watermark: model=opus-5.5; effort=high; duration=40m; seat=claude-code; date=2026-10-05 */
import { isProviderAvailable, type ModelSelection, type ServerProvider } from "@t3tools/contracts";
import type { HandoffMessage } from "@t3tools/shared/handoff";

import { getTriggerDisplayModelLabel } from "../chat/providerIconUtils";

/** Providers that can take a turn right now. */
export function handoffProviders(providers: ReadonlyArray<ServerProvider>): ServerProvider[] {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      isProviderAvailable(provider) &&
      provider.status === "ready" &&
      provider.models.length > 0,
  );
}

export function providerLabel(
  provider: Pick<ServerProvider, "displayName" | "instanceId">,
): string {
  return provider.displayName?.trim() || provider.instanceId;
}

/** "Claude · Fable 5.1", without repeating a provider name the model label already carries. */
export function agentLabel(provider: ServerProvider, model: string): string {
  const name = providerLabel(provider);
  const found = provider.models.find((item) => item.slug === model);
  const modelLabel = found ? getTriggerDisplayModelLabel(found) : model;
  const trimmed = modelLabel.toLowerCase().startsWith(`${name.toLowerCase()} `)
    ? modelLabel.slice(name.length + 1)
    : modelLabel;
  return `${name} · ${trimmed}`;
}

export interface HandoffTarget {
  readonly instanceId: ServerProvider["instanceId"];
  readonly model: string;
}

function defaultModel(provider: ServerProvider): string {
  return (provider.models.find((model) => model.isDefault) ?? provider.models[0])?.slug ?? "";
}

/**
 * The usual reason to hand off is that the current provider stopped (limit,
 * outage, wrong strengths), so prefer a different driver, then a different
 * instance of the same driver, and only then the same instance.
 */
export function defaultHandoffTarget(
  providers: ReadonlyArray<ServerProvider>,
  source: ModelSelection,
): HandoffTarget | null {
  const sourceDriver = providers.find(
    (provider) => provider.instanceId === source.instanceId,
  )?.driver;
  const pick =
    providers.find((provider) => sourceDriver !== undefined && provider.driver !== sourceDriver) ??
    providers.find((provider) => provider.instanceId !== source.instanceId) ??
    providers[0];
  return pick ? { instanceId: pick.instanceId, model: defaultModel(pick) } : null;
}

export function retargetHandoff(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: string,
): HandoffTarget | null {
  const provider = providers.find((item) => item.instanceId === instanceId);
  return provider ? { instanceId: provider.instanceId, model: defaultModel(provider) } : null;
}

export function validateHandoff(input: {
  readonly target: HandoffTarget | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly sourceRunning: boolean;
  readonly hasMessages: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.providers.length === 0) {
    return { ok: false, reason: "Set up a ready provider in Settings → Providers to hand off." };
  }
  if (!input.target) return { ok: false, reason: "Choose an agent to continue with." };
  const provider = input.providers.find((item) => item.instanceId === input.target!.instanceId);
  if (!provider) return { ok: false, reason: "That provider is no longer available." };
  if (!provider.models.some((model) => model.slug === input.target!.model)) {
    return { ok: false, reason: "Choose a model." };
  }
  if (!input.hasMessages) return { ok: false, reason: "This thread has nothing to hand off yet." };
  if (input.sourceRunning) {
    return {
      ok: false,
      reason:
        "The current agent is still working in this checkout. Stop it first so two agents don't edit the same files.",
    };
  }
  return { ok: true };
}

/** Transcript text only; attachments and tool chatter stay in the source thread. */
export function handoffMessages(
  messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
    readonly streaming?: boolean;
  }>,
): HandoffMessage[] {
  return messages
    .filter((message) => !message.streaming)
    .flatMap((message) =>
      message.role === "user" || message.role === "assistant" || message.role === "system"
        ? [{ role: message.role, text: message.text }]
        : [],
    );
}

/** What a finished review found: its proposed plan, else its last non-empty reply. */
export function reviewFindings(thread: {
  readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
  readonly proposedPlans: ReadonlyArray<{ readonly planMarkdown: string }>;
}): string {
  const plan = thread.proposedPlans.at(-1)?.planMarkdown?.trim();
  if (plan) return plan;
  return (
    thread.messages
      .toReversed()
      .find((message) => message.role === "assistant" && message.text.trim().length > 0)
      ?.text.trim() ?? ""
  );
}
