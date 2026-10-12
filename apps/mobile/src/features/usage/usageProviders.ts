/* agent-watermark: model=muse-spark; effort=high; duration=50m; seat=opencode; date=2026-10-07 */
/* agent-watermark: model=grok-4.7; effort=default; duration=40m; seat=cursor; date=2026-09-30 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=5m; seat=antigravity; date=2026-10-01 */
import type { UsageProviderKind } from "@t3tools/contracts";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

/**
 * Series and table order. The chart stacks providers from the bottom in this
 * order, so it also fixes which band sits on top of the bars.
 */
export const PROVIDER_ORDER: readonly UsageProviderKind[] = [
  "codex",
  "claude",
  "grok",
  "opencode",
  "antigravity",
];

export const PROVIDER_LABEL: Record<UsageProviderKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok Build",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

/** Maps a live provider driver onto the usage series. */
export function usageKindForDriver(driver: string): UsageProviderKind | null {
  if (driver === "codex") return "codex";
  if (driver === "claudeAgent") return "claude";
  if (driver === "grok") return "grok";
  if (driver === "opencode") return "opencode";
  if (driver === "antigravity") return "antigravity";
  return null;
}

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
 * Providers the mobile usage screen should show.
 * Includes providers with usage, present transcript sources, and configured harnesses.
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
        provider !== null && provider !== undefined && provider in PROVIDER_LABEL,
    ),
  );
  return PROVIDER_ORDER.filter(
    (provider) => active.has(provider) || present.has(provider) || connected.has(provider),
  );
}

/**
 * Claude's brand orange holds in both themes; Codex and Grok are neutrals and
 * must flip with the theme or their bars vanish against the matching background.
 */
export function useProviderColors(): Record<UsageProviderKind, string> {
  const { themeAppearance: scheme } = useAppearancePreferences();
  return {
    claude: "#d97757",
    codex: scheme === "dark" ? "#e6e6e6" : "#3c3c43",
    grok: scheme === "dark" ? "#a1a1aa" : "#52525b",
    opencode: "#0f766e",
    antigravity: "#1a73e8",
  };
}
