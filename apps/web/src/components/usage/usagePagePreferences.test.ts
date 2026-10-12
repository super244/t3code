/* agent-watermark: model=muse-spark; effort=high; duration=50m; seat=opencode; date=2026-10-07 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=5m; seat=antigravity; date=2026-10-02 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { readUsagePagePreferences, saveUsagePagePreferences } from "./usagePagePreferences";

const key = "t3code:usage-page-preferences:v1";
let values: Map<string, string>;
let storage: Pick<Storage, "getItem" | "setItem">;

beforeEach(() => {
  values = new Map();
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  vi.stubGlobal("window", { localStorage: storage });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Usage page preferences", () => {
  it("uses defaults when no preference has been saved", () => {
    expect(readUsagePagePreferences()).toEqual({ metric: "cost", windowPreset: "30d" });
  });

  it.each([
    "1h",
    "5h",
    "12h",
    "24h",
    "3d",
    "7d",
    "30d",
    "90d",
    "180d",
    "1y",
    "2y",
    "5y",
    "all",
  ] as const)("round-trips every metric with the %s range", (windowPreset) => {
    for (const metric of ["cost", "tokens", "limits"] as const) {
      saveUsagePagePreferences({ metric, windowPreset });
      expect(readUsagePagePreferences()).toEqual({ metric, windowPreset });
    }
  });

  it.each([
    "not-json",
    '{"metric":"unknown","windowDays":7}',
    '{"metric":"cost","windowDays":365}',
  ])("replaces invalid preferences on the next save: %s", (value) => {
    values.set(key, value);
    expect(readUsagePagePreferences()).toEqual({ metric: "cost", windowPreset: "30d" });
    saveUsagePagePreferences({ metric: "tokens", windowPreset: "7d" });
    expect(readUsagePagePreferences()).toEqual({ metric: "tokens", windowPreset: "7d" });
  });

  it("contains write failures and can save again after storage recovers", () => {
    saveUsagePagePreferences({ metric: "cost", windowPreset: "30d" });
    const write = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveUsagePagePreferences({ metric: "tokens", windowPreset: "7d" })).not.toThrow();
    expect(readUsagePagePreferences()).toEqual({ metric: "cost", windowPreset: "30d" });
    write.mockRestore();
    saveUsagePagePreferences({ metric: "limits", windowPreset: "7d" });
    expect(readUsagePagePreferences()).toEqual({ metric: "limits", windowPreset: "7d" });
  });

  it("contains failures when the browser blocks storage access", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("SecurityError");
      },
    });
    expect(readUsagePagePreferences()).toEqual({ metric: "cost", windowPreset: "30d" });
    expect(() => saveUsagePagePreferences({ metric: "tokens", windowPreset: "7d" })).not.toThrow();
  });
});

it("retains legacy metric/range preferences and persists focused harness or All", () => {
  values.set(key, '{"metric":"tokens","windowPreset":"7d"}');
  const legacy = readUsagePagePreferences();
  expect(legacy).toEqual({ metric: "tokens", windowPreset: "7d" });
  for (const provider of ["codex", "claude", "grok", "opencode", "antigravity", null] as const) {
    saveUsagePagePreferences({ ...legacy, provider });
    expect(readUsagePagePreferences()).toEqual({ ...legacy, provider });
  }
});

it("persists and updates monthly budget target", () => {
  const prefs = readUsagePagePreferences();
  saveUsagePagePreferences({ ...prefs, monthlyBudgetUsd: 100 });
  expect(readUsagePagePreferences().monthlyBudgetUsd).toBe(100);

  saveUsagePagePreferences({ ...prefs, monthlyBudgetUsd: null });
  expect(readUsagePagePreferences().monthlyBudgetUsd).toBeNull();
});
