/* agent-watermark: model=muse-spark; effort=high; duration=50m; seat=opencode; date=2026-10-07 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=15m; seat=antigravity; date=2026-10-01 */
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { MISSION_RECIPES, missionModelSelection, missionProviders } from "./missionLauncher.logic";

const provider = (id: string, overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(id),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-01T00:00:00.000Z",
  slashCommands: [],
  skills: [],
  models: [
    { slug: "fast", name: "Fast", isCustom: false, capabilities: null },
    { slug: "capable", name: "Capable", isCustom: false, capabilities: null, isDefault: true },
  ],
  ...overrides,
});

describe("mission selection", () => {
  it("routes the exact subscription instance and valid project model", () => {
    const providers = [provider("personal"), provider("work")];
    expect(
      missionModelSelection(providers, {
        instanceId: ProviderInstanceId.make("work"),
        model: "fast",
      }),
    ).toEqual({ instanceId: "work", model: "fast" });
  });

  it("falls back to the configured model when a saved model disappears", () => {
    expect(
      missionModelSelection([provider("work")], {
        instanceId: ProviderInstanceId.make("work"),
        model: "retired",
      }),
    ).toEqual({ instanceId: "work", model: "capable" });
  });

  it("does not resurrect missing, disabled, offline-driver, or unready subscriptions", () => {
    const unavailable = [
      provider("disabled", { enabled: false }),
      provider("uninstalled", { installed: false }),
      provider("shadow", { availability: "unavailable" }),
      provider("error", { status: "error" }),
      provider("warning", { status: "warning" }),
      provider("no-models", { models: [] }),
    ];
    expect(missionProviders(unavailable)).toEqual([]);
    expect(missionModelSelection(unavailable, null)).toBeNull();
  });

  it("resolves only models from the new computer's provider snapshot", () => {
    expect(
      missionModelSelection(
        [
          provider("work", {
            models: [{ slug: "remote-model", name: "Remote", isCustom: false, capabilities: null }],
          }),
        ],
        { instanceId: ProviderInstanceId.make("work"), model: "capable" },
      ),
    ).toEqual({ instanceId: "work", model: "remote-model" });
  });
});

describe("explicit mission routing", () => {
  it("blocks a removed subscription instead of silently choosing another account", () => {
    expect(
      missionModelSelection(
        [provider("personal")],
        { instanceId: ProviderInstanceId.make("work"), model: "fast" },
        true,
      ),
    ).toBeNull();
  });
  it("blocks a removed explicitly selected model instead of silently choosing a default", () => {
    expect(
      missionModelSelection(
        [provider("work")],
        { instanceId: ProviderInstanceId.make("work"), model: "retired" },
        true,
      ),
    ).toBeNull();
    expect(
      missionModelSelection(
        [provider("work")],
        { instanceId: ProviderInstanceId.make("work"), model: "fast" },
        true,
      ),
    ).toEqual({ instanceId: "work", model: "fast" });
  });
});

describe("MISSION_RECIPES", () => {
  it("defines unique IDs and valid prompt configurations for all recipes", () => {
    const ids = new Set<string>();
    for (const recipe of MISSION_RECIPES) {
      expect(recipe.id).toBeTruthy();
      expect(ids.has(recipe.id)).toBe(false);
      ids.add(recipe.id);
      expect(recipe.label).toBeTruthy();
      if (recipe.id !== "custom") {
        expect(recipe.prompt.trim().length).toBeGreaterThan(10);
      }
    }
    expect(ids.has("custom")).toBe(true);
    expect(ids.has("implement")).toBe(true);
    expect(ids.has("debug")).toBe(true);
    expect(ids.has("review")).toBe(true);
    expect(ids.has("refactor")).toBe(true);
    expect(ids.has("security")).toBe(true);
    expect(ids.has("optimize")).toBe(true);
    expect(ids.has("tests")).toBe(true);
  });
});
