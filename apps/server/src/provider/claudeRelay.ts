/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=25m; seat=antigravity; date=2026-10-17 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=60m; seat=codex; date=2026-10-15 */
/* agent-watermark: model=opus-5.5; effort=high; duration=35m; seat=claude-code; date=2026-10-13 */
// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- a loopback call to a local service, made from both Effect and plain callbacks; same footing as upstreamNightly.ts.
/**
 * Claude Relay (MyLifeOS `Second-Brain/PROJECTS/claude-relay`, 127.0.0.1:3975)
 * — the local service that bills Claude to this Mac's Max plan API credit and
 * keeps one spend ledger for every Claude caller.
 *
 * T3 uses it two ways: tool-free text generation (commit messages, titles…)
 * runs through it, and coding-agent sessions, which need built-in tools the
 * relay refuses, report each turn's cost to its ledger so the cap stays true.
 *
 * Absent relay (no token file, nothing listening) → callers behave exactly as
 * before. `T3CODE_CLAUDE_RELAY=0` turns it off; under a test runner it is off
 * unless `T3CODE_CLAUDE_RELAY=1`, because a live relay spends real credit.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export const CLAUDE_RELAY_TOKEN_PATH = NodePath.join(
  NodeOS.homedir(),
  "Library",
  "Application Support",
  "claude-relay",
  "token",
);

export interface ClaudeRelay {
  readonly token: string;
  readonly baseUrl: string;
}

export const detectClaudeRelay = (
  env: Record<string, string | undefined> = process.env,
): ClaudeRelay | undefined => {
  if (env.T3CODE_CLAUDE_RELAY === "0") return undefined;
  if (env.VITEST && env.T3CODE_CLAUDE_RELAY !== "1") return undefined;
  try {
    const token = NodeFS.readFileSync(
      env.T3CODE_CLAUDE_RELAY_TOKEN_FILE || CLAUDE_RELAY_TOKEN_PATH,
      "utf8",
    ).trim();
    if (!token) return undefined;
    return {
      token,
      baseUrl: (env.T3CODE_CLAUDE_RELAY_URL || "http://127.0.0.1:3975").replace(/\/$/, ""),
    };
  } catch {
    return undefined;
  }
};

/** The relay was not there to ask; the caller should use its own path. */
export class ClaudeRelayUnavailable extends Error {}

/**
 * One tool-free, memory-free relay turn returning the structured output for
 * `schema`. Throws `ClaudeRelayUnavailable` only when the relay could not be
 * reached; a refusal it explains is a plain Error with its reason.
 */
export const relayStructuredTurn = async (
  relay: ClaudeRelay,
  input: {
    readonly prompt: string;
    readonly schema: unknown;
    readonly model: string;
    readonly timeoutMs: number;
  },
): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(`${relay.baseUrl}/v1/turn`, {
      method: "POST",
      headers: { authorization: `Bearer ${relay.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        app: "t3code",
        thread: null,
        memory: false,
        prompt: input.prompt,
        schema: input.schema,
        model: input.model,
        timeoutMs: input.timeoutMs,
      }),
      signal: AbortSignal.timeout(input.timeoutMs + 10_000),
    });
  } catch (cause) {
    const code = (cause as { cause?: { code?: string } }).cause?.code;
    if (code === "ECONNREFUSED" || code === "ENOENT")
      throw new ClaudeRelayUnavailable(String(code));
    throw new Error(`Claude Relay request failed: ${String((cause as Error)?.message ?? cause)}`, {
      cause,
    });
  }
  if (response.status === 401) throw new ClaudeRelayUnavailable("token rejected");
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    structured?: unknown;
    text?: string;
    error?: string;
  };
  if (data.ok !== true) throw new Error(`Claude Relay: ${data.error ?? `HTTP ${response.status}`}`);
  if (data.structured !== null && data.structured !== undefined) return data.structured;
  return JSON.parse(data.text ?? "null") as unknown;
};

/**
 * Report cumulative spend under an idempotent runtime scope. Acknowledgement
 * failures are returned to the adapter so missing spend is visible.
 */
export const reportClaudeSpend = async (
  relay: ClaudeRelay | undefined,
  input: {
    readonly sessionId: string | undefined;
    readonly totalCostUsd: number | undefined;
    readonly apiKeySource: string | undefined;
    readonly resumed: boolean;
    /** Per-process scope plus the SDK usage total read before any prompt. */
    readonly accountingId?: string;
    readonly baselineCostUsd?: number;
  },
): Promise<"reported" | "skipped" | "failed"> => {
  if (!relay) return "skipped";
  if (
    !input.sessionId ||
    typeof input.totalCostUsd !== "number" ||
    !Number.isFinite(input.totalCostUsd) ||
    input.totalCostUsd < 0
  )
    return "failed";
  const scoped =
    input.accountingId !== undefined &&
    typeof input.baselineCostUsd === "number" &&
    Number.isFinite(input.baselineCostUsd) &&
    input.baselineCostUsd >= 0;
  if (input.accountingId !== undefined && !scoped) return "failed";
  const body = JSON.stringify({
    app: "t3code",
    sessionId: scoped ? `t3:${input.accountingId}:${input.sessionId}` : input.sessionId,
    totalCostUsd: scoped
      ? Math.max(0, input.totalCostUsd - input.baselineCostUsd!)
      : input.totalCostUsd,
    ...(input.apiKeySource ? { apiKeySource: input.apiKeySource } : {}),
    resumed: scoped ? false : input.resumed,
  });
  // Retrying the same cumulative total is safe even if the first response
  // was lost after the relay persisted it.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${relay.baseUrl}/v1/ledger`, {
        method: "POST",
        headers: { authorization: `Bearer ${relay.token}`, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      const receipt = (await response.json().catch(() => null)) as { ok?: boolean } | null;
      if (response.ok && receipt?.ok === true) return "reported";
      if (response.status < 500 && response.status !== 429) return "failed";
    } catch {
      // Network errors can be transient; the second attempt shares the key.
    }
  }
  return "failed";
};

export interface ClaudeRelayLedgerSummary {
  readonly cycleStart: string;
  readonly capUsd: number;
  readonly creditsUsd: number;
  readonly remainingUsd: number;
  readonly subscriptionUsdEstimate?: number;
  readonly turns?: number;
  readonly estimatedUsd?: number;
  readonly exhausted?: { readonly reason: string; readonly at: string; readonly until?: string } | null;
}

export interface ClaudeRelayStatus {
  readonly creditKey?: { readonly present: boolean; readonly source?: string; readonly reason?: string };
  readonly subscriptionToken?: { readonly present: boolean; readonly source?: string };
  readonly nextTurnMode?: string;
  readonly nextTurnReason?: string | null;
  readonly fallback?: string;
  readonly defaultModel?: string;
  readonly ledger?: ClaudeRelayLedgerSummary;
}

export const fetchClaudeRelayStatus = async (
  relay: ClaudeRelay | undefined,
): Promise<ClaudeRelayStatus | undefined> => {
  if (!relay) return undefined;
  try {
    const response = await fetch(`${relay.baseUrl}/v1/status`, {
      headers: { authorization: `Bearer ${relay.token}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return undefined;
    return (await response.json().catch(() => undefined)) as ClaudeRelayStatus | undefined;
  } catch {
    return undefined;
  }
};
