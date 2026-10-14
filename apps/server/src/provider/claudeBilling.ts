/* agent-watermark: model=opus-5.5; effort=high; duration=45m; seat=claude-code; date=2026-10-13 */
// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- reads two macOS Keychain items (cached 30 s by wall clock) through /usr/bin/security, a local OS call outside the Effect platform services; same footing as claudeRelay.ts.
/**
 * Which Claude account a thread bills: the Max plan's monthly API credit
 * ("promo credits", drawn by Agent SDK usage on the Console organization
 * linked to the plan) or the Max subscription itself.
 *
 * T3's Claude threads already run on the Agent SDK. What decides who pays is
 * the credential the session process starts with, so the "Promo credits"
 * model option swaps that credential and nothing else: same model, same
 * tools, same conversation (a Claude session restarts with its resume cursor
 * whenever its model selection changes, options included).
 *
 *   promo credits on   the relay's credit key (Keychain claude-relay/credits)
 *                      when one is stored, else the `claude` login, with any
 *                      subscription token removed
 *   promo credits off  a `claude setup-token` OAuth token (Keychain
 *                      claude-relay/subscription), with API keys removed
 *
 * Only the default Claude instance gets the option: an instance with its own
 * config directory chose its account by logging in there.
 */
import * as NodeChildProcess from "node:child_process";

import type { ModelCapabilities, ProviderOptionDescriptor } from "@t3tools/contracts";

export const PROMO_CREDITS_OPTION_ID = "promoCredits";

const KEYCHAIN_SERVICE = "claude-relay";
const CACHE_MS = 30_000;

export interface ClaudeCredentials {
  /** A Console API key for the organization that receives the monthly credit. */
  readonly creditKey: string | undefined;
  /** A `claude setup-token` OAuth token for the Max subscription. */
  readonly subscriptionToken: string | undefined;
}

type KeychainReader = (account: string) => string | undefined;

const readKeychain: KeychainReader = (account) => {
  try {
    const value = NodeChildProcess.execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
      { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
};

let cached: { readonly at: number; readonly value: ClaudeCredentials } | undefined;

/**
 * The stored credentials, from the environment first and the Keychain second.
 * Off under a test runner unless `T3CODE_CLAUDE_BILLING=1`, so no suite reads
 * a real credential.
 */
export const readClaudeCredentials = (
  env: Record<string, string | undefined> = process.env,
  reader: KeychainReader = readKeychain,
  now: number = Date.now(),
): ClaudeCredentials => {
  const underTest = Boolean(env.VITEST || process.env.VITEST);
  if (env.T3CODE_CLAUDE_BILLING === "0" || (underTest && env.T3CODE_CLAUDE_BILLING !== "1")) {
    return { creditKey: undefined, subscriptionToken: undefined };
  }
  // A test that opts in still never touches the real Keychain.
  const keychain: KeychainReader = underTest && reader === readKeychain ? () => undefined : reader;
  const useCache = keychain === readKeychain;
  if (useCache && cached && now - cached.at < CACHE_MS) return cached.value;
  const value: ClaudeCredentials = {
    creditKey: env.T3CODE_CLAUDE_CREDIT_KEY || keychain("credits"),
    subscriptionToken: env.T3CODE_CLAUDE_SUBSCRIPTION_TOKEN || keychain("subscription"),
  };
  if (useCache) cached = { at: now, value };
  return value;
};

/**
 * The toggle as it appears under the model. Its default follows what can
 * actually be billed: with no subscription token stored, every thread already
 * runs on the credit, so the switch starts on rather than promising a
 * subscription it cannot reach.
 */
export const promoCreditsDescriptor = (
  credentials: ClaudeCredentials,
): ProviderOptionDescriptor => ({
  id: PROMO_CREDITS_OPTION_ID,
  label: "Promo credits",
  // Shown under the switch only while the subscription cannot be used yet.
  ...(credentials.subscriptionToken
    ? {}
    : {
        description:
          "To use the subscription instead, run claude setup-token once and save the token as Keychain item claude-relay/subscription.",
      }),
  type: "boolean",
  currentValue: credentials.subscriptionToken === undefined,
});

export const withPromoCreditsOption = (
  capabilities: ModelCapabilities,
  credentials: ClaudeCredentials,
): ModelCapabilities => {
  const existing = capabilities.optionDescriptors ?? [];
  if (existing.some((descriptor) => descriptor.id === PROMO_CREDITS_OPTION_ID)) return capabilities;
  return { ...capabilities, optionDescriptors: [...existing, promoCreditsDescriptor(credentials)] };
};

/** Whether a selection asked for promo credits; an unset option takes the descriptor's default. */
export const wantsPromoCredits = (
  selected: boolean | undefined,
  credentials: ClaudeCredentials,
): boolean => selected ?? credentials.subscriptionToken === undefined;

const SUBSCRIPTION_VARIABLES = ["CLAUDE_CODE_OAUTH_TOKEN"] as const;
const API_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

export type ClaudeBillingEnvironment =
  | {
      readonly ok: true;
      readonly billing: "credits" | "subscription";
      readonly env: NodeJS.ProcessEnv;
    }
  | { readonly ok: false; readonly reason: string };

/** The session environment for the chosen billing, built from the instance's own environment. */
export const claudeBillingEnvironment = (
  base: NodeJS.ProcessEnv,
  promoCredits: boolean,
  credentials: ClaudeCredentials,
): ClaudeBillingEnvironment => {
  const env: NodeJS.ProcessEnv = { ...base };
  if (promoCredits) {
    for (const name of SUBSCRIPTION_VARIABLES) delete env[name];
    if (credentials.creditKey) {
      for (const name of API_KEY_VARIABLES) delete env[name];
      env.ANTHROPIC_API_KEY = credentials.creditKey;
    }
    return { ok: true, billing: "credits", env };
  }
  if (!credentials.subscriptionToken) {
    return {
      ok: false,
      reason:
        "Promo credits is off, but no subscription token is stored. Run `claude setup-token`, store the token with `security add-generic-password -U -s claude-relay -a subscription -w`, then send again, or turn Promo credits back on.",
    };
  }
  for (const name of API_KEY_VARIABLES) delete env[name];
  env.CLAUDE_CODE_OAUTH_TOKEN = credentials.subscriptionToken;
  return { ok: true, billing: "subscription", env };
};
