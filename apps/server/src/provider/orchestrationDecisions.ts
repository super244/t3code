/* agent-watermark: model=muse-spark; effort=high; duration=45m; seat=opencode; date=2026-10-10 */
import type { ProviderDriverKind } from "@t3tools/contracts";

/**
 * Orchestration contract for one provider driver: the explicit decision
 * orchestration relies on instead of probing each adapter at runtime.
 *
 * Source of truth stays in each adapter's `capabilities`
 * (`provider/Layers/*Adapter.ts`); this table mirrors those declarations so a
 * missing or changed decision is a visible, tested diff rather than a silent
 * behavioral drift. When an adapter's capabilities change, update its row here.
 */
export interface ProviderOrchestrationDecision {
  /**
   * How checkpoint restore rewinds the provider conversation. `native` means
   * the adapter implements `rollbackThread`; `unsupported` means restore
   * stops at the filesystem checkpoint and reports the limit.
   */
  readonly conversationRollback: "native" | "unsupported";
  /** Whether a running session can switch models without a restart. */
  readonly sessionModelSwitch: "in-session" | "unsupported";
  /** True when a resumed turn needs no synthetic user prompt. */
  readonly promptlessTurnContinuation: boolean;
  /** How manual context compaction is triggered for this driver. */
  readonly compaction:
    | { readonly kind: "native" }
    | { readonly kind: "slash-command"; readonly command: `/${string}` };
  /**
   * Approval and user-input answers always travel through the adapter's own
   * runtime (`respondToRequest` / `respondToUserInput`); every built-in
   * driver implements both, so orchestration never branches here.
   */
  readonly interactiveResponse: "native";
}

/**
 * Explicit orchestration decision per built-in driver. Keys must cover every
 * `driverKind` in `BUILT_IN_DRIVERS` (enforced by
 * `orchestrationDecisions.test.ts`): adding a driver without a decision here
 * fails the suite.
 */
export const PROVIDER_ORCHESTRATION_DECISIONS: Readonly<
  Record<string, ProviderOrchestrationDecision>
> = {
  // CodexAdapter capabilities: in-session model switch, promptless
  // continuation, native compaction, rollbackThread.
  codex: {
    conversationRollback: "native",
    sessionModelSwitch: "in-session",
    promptlessTurnContinuation: true,
    compaction: { kind: "native" },
    interactiveResponse: "native",
  },
  // ClaudeAdapter capabilities: in-session model switch, `/compact`,
  // rollbackThread.
  claudeAgent: {
    conversationRollback: "native",
    sessionModelSwitch: "in-session",
    promptlessTurnContinuation: false,
    compaction: { kind: "slash-command", command: "/compact" },
    interactiveResponse: "native",
  },
  // CursorAdapter capabilities: in-session model switch, `/compress`,
  // rollbackThread.
  cursor: {
    conversationRollback: "native",
    sessionModelSwitch: "in-session",
    promptlessTurnContinuation: false,
    compaction: { kind: "slash-command", command: "/compress" },
    interactiveResponse: "native",
  },
  // GrokAdapter capabilities: in-session model switch, `/compact`,
  // rollbackThread.
  grok: {
    conversationRollback: "native",
    sessionModelSwitch: "in-session",
    promptlessTurnContinuation: false,
    compaction: { kind: "slash-command", command: "/compact" },
    interactiveResponse: "native",
  },
  // OpenCodeAdapter capabilities: in-session model switch, native compaction,
  // rollbackThread.
  opencode: {
    conversationRollback: "native",
    sessionModelSwitch: "in-session",
    promptlessTurnContinuation: false,
    compaction: { kind: "native" },
    interactiveResponse: "native",
  },
  // AntigravityAdapter capabilities: in-session model switch,
  // `supportsConversationRollback: false`, `/compact`. Checkpoint restore is
  // filesystem-only here; CheckpointReactor reports the limit via
  // `assertConversationRollbackSupported`.
  antigravity: {
    conversationRollback: "unsupported",
    sessionModelSwitch: "in-session",
    promptlessTurnContinuation: false,
    compaction: { kind: "slash-command", command: "/compact" },
    interactiveResponse: "native",
  },
};

export const getProviderOrchestrationDecision = (
  driverKind: ProviderDriverKind,
): ProviderOrchestrationDecision | undefined => PROVIDER_ORCHESTRATION_DECISIONS[driverKind];
