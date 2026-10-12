/* agent-watermark: model=grok-4.7; effort=default; duration=58m; seat=cursor; date=2026-09-30 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=15m; seat=antigravity; date=2026-09-30 */
import type { UsageProviderKind } from "@t3tools/contracts";

import { AntigravityIcon, ClaudeAI, GrokIcon, type Icon, OpenAI, OpenCodeIcon } from "../Icons";

type UsageProviderPresentation = {
  readonly label: string;
  readonly color: string;
  readonly mark: Icon;
};

/**
 * Exhaustive presentation for providers supported by the usage contract.
 * Declaration order is reused by every chart and table, so adding a provider
 * only requires its contract support and one entry here.
 */
export const PROVIDER_PRESENTATION = {
  codex: {
    label: "Codex",
    color: "#10b981", // Emerald OpenAI
    mark: OpenAI,
  },
  claude: {
    label: "Claude Code",
    color: "#f97316", // Coral Anthropic
    mark: ClaudeAI,
  },
  grok: {
    label: "Grok Build",
    color: "#f43f5e", // Vibrant Rose Grok
    mark: GrokIcon,
  },
  opencode: {
    label: "OpenCode",
    color: "#06b6d4", // Electric Cyan OpenCode
    mark: OpenCodeIcon,
  },
  antigravity: {
    label: "Antigravity",
    color: "#38bdf8", // Prism Electric Sky Antigravity
    mark: AntigravityIcon,
  },
} satisfies Record<UsageProviderKind, UsageProviderPresentation>;

/** Maps a live provider driver onto the usage series, when that harness is scanned. */
export function usageKindForDriver(driver: string): UsageProviderKind | null {
  if (driver === "codex") return "codex";
  if (driver === "claudeAgent") return "claude";
  if (driver === "grok") return "grok";
  if (driver === "opencode") return "opencode";
  if (driver === "antigravity") return "antigravity";
  return null;
}

/** Stable provider reading order across charts, summaries, tables, and hover rows. */
export const PROVIDER_ORDER = Object.keys(PROVIDER_PRESENTATION) as UsageProviderKind[];

/** Providers with real activity, independent of the metric currently displayed. */
export function providersWithUsage(
  totals: readonly {
    readonly provider: UsageProviderKind;
    readonly costUsd: number;
    readonly totalTokens: number;
  }[],
): readonly UsageProviderKind[] {
  const active = new Set(
    totals
      .filter((entry) => entry.totalTokens > 0 || entry.costUsd > 0)
      .map((entry) => entry.provider),
  );
  return PROVIDER_ORDER.filter((provider) => active.has(provider));
}

/**
 * Providers the usage screen should name.
 *
 * Activity wins. A store that exists but has nothing in the selected window
 * still appears, and any connected harness configured on the environment is
 * included so it is not invisible just because this range is quiet.
 */
export function providersOnUsageScreen(
  totals: readonly {
    readonly provider: UsageProviderKind;
    readonly costUsd: number;
    readonly totalTokens: number;
  }[],
  sources: readonly {
    readonly provider: UsageProviderKind;
    readonly status: string;
  }[] = [],
  connectedProviders: readonly (UsageProviderKind | null | undefined)[] = [],
): readonly UsageProviderKind[] {
  const active = new Set(providersWithUsage(totals));
  const present = new Set(
    sources
      .filter((source) => source.status === "ok" || source.status === "partial")
      .map((source) => source.provider),
  );
  const connected = new Set(
    connectedProviders.filter(
      (provider): provider is UsageProviderKind =>
        provider !== null && provider !== undefined && provider in PROVIDER_PRESENTATION,
    ),
  );
  return PROVIDER_ORDER.filter(
    (provider) => active.has(provider) || present.has(provider) || connected.has(provider),
  );
}
