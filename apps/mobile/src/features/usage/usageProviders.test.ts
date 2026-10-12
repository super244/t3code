/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=5m; seat=antigravity; date=2026-10-01 */
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeAppearance: "dark" }),
}));

import {
  PROVIDER_ORDER,
  providersOnUsageScreen,
  providersWithUsage,
  usageKindForDriver,
} from "./usageProviders";

describe("mobile usageProviders", () => {
  it("maps provider drivers correctly", () => {
    expect(usageKindForDriver("codex")).toBe("codex");
    expect(usageKindForDriver("claudeAgent")).toBe("claude");
    expect(usageKindForDriver("grok")).toBe("grok");
    expect(usageKindForDriver("opencode")).toBe("opencode");
    expect(usageKindForDriver("antigravity")).toBe("antigravity");
    expect(usageKindForDriver("unknown")).toBeNull();
  });

  it("identifies active providers with usage", () => {
    const totals = [
      { provider: "claude" as const, costUsd: 1.5, totalTokens: 1000 },
      { provider: "antigravity" as const, costUsd: 0, totalTokens: 0 },
    ];
    expect(providersWithUsage(totals)).toEqual(["claude"]);
  });

  it("includes quiet connected providers on usage screen", () => {
    const totals = [{ provider: "codex" as const, costUsd: 0.5, totalTokens: 200 }];
    const sources = [{ provider: "claude" as const, status: "ok" }];
    const connected = ["opencode" as const, "antigravity" as const];

    const result = providersOnUsageScreen(totals, sources, connected);
    expect(result).toEqual(["codex", "claude", "opencode", "antigravity"]);
  });

  it("preserves stable PROVIDER_ORDER", () => {
    const all = providersOnUsageScreen([], [], PROVIDER_ORDER);
    expect(all).toEqual(PROVIDER_ORDER);
  });
});
