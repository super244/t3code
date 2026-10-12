/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off tryCatchInEffectGen:off globalDateInEffect:off globalDate:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { EnvironmentThemeFile } from "@t3tools/contracts";
import { PRISM_FLAGSHIP_THEMES } from "@t3tools/shared/themePalettes";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ServerConfig from "./config.ts";

export type { PrismBridgeStatus } from "@t3tools/shared/prismBridge";
import type { PrismBridgeStatus } from "@t3tools/shared/prismBridge";
export class PrismBridgeService extends Context.Service<
  PrismBridgeService,
  {
    readonly syncNow: Effect.Effect<PrismBridgeStatus>;
    readonly status: Effect.Effect<PrismBridgeStatus>;
  }
>()("t3/prismBridge/PrismBridgeService") {}

/** Every server instance owns its state and writes only into its configured home. */
export function makePrismBridge(
  themesDir: string,
  settingsPath = NodePath.join(
    NodeOS.homedir(),
    "Library",
    "Application Support",
    "Prism",
    "settings.json",
  ),
) {
  let status: PrismBridgeStatus = {
    synced: false,
    activeThemeId: null,
    activeThemeName: null,
    lastSyncedAt: null,
    settingsPath: null,
    error: null,
  };
  const syncNow = (): PrismBridgeStatus => {
    try {
      if (!NodeFS.existsSync(settingsPath))
        throw new Error("Prism settings were not found on this computer.");
      const parsed: unknown = JSON.parse(NodeFS.readFileSync(settingsPath, "utf8"));
      const id =
        parsed && typeof parsed === "object" && "activeThemeID" in parsed
          ? parsed.activeThemeID
          : null;
      if (typeof id !== "string") throw new Error("Prism settings do not specify an active theme.");
      const normalized = id.replace(/^prism\./, "prism-").toLowerCase();
      const theme = PRISM_FLAGSHIP_THEMES.find(
        (theme) =>
          theme.id === (normalized.startsWith("prism-") ? normalized : `prism-${normalized}`),
      );
      if (!theme) throw new Error("The active Prism theme does not have a matching T3 palette.");
      const themeFile: EnvironmentThemeFile = {
        name: theme.label,
        appearance: theme.appearance,
        colors: theme.colors as unknown as Record<string, string>,
        variants: theme.variants as unknown as {
          light?: Record<string, string>;
          dark?: Record<string, string>;
        },
      };
      NodeFS.mkdirSync(themesDir, { recursive: true });
      const target = NodePath.join(themesDir, "prism.json");
      const contents = JSON.stringify(themeFile, null, 2);
      // Avoid rewriting on unrelated settings changes; publish the file atomically.
      if (!NodeFS.existsSync(target) || NodeFS.readFileSync(target, "utf8") !== contents) {
        const temporary = `${target}.${process.pid}.tmp`;
        try {
          NodeFS.writeFileSync(temporary, contents, "utf8");
          NodeFS.renameSync(temporary, target);
        } finally {
          if (NodeFS.existsSync(temporary)) NodeFS.unlinkSync(temporary);
        }
      }
      status = {
        synced: true,
        activeThemeId: theme.id,
        activeThemeName: theme.label,
        lastSyncedAt: new Date().toISOString(),
        settingsPath,
        error: null,
      };
    } catch (cause) {
      status = {
        ...status,
        synced: false,
        settingsPath: NodeFS.existsSync(settingsPath) ? settingsPath : null,
        error: cause instanceof Error ? cause.message : "Could not sync the Prism palette.",
      };
    }
    return status;
  };
  return { syncNow, status: () => status, settingsPath };
}

const make = Effect.gen(function* () {
  const { environmentThemesDir } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const bridge = makePrismBridge(environmentThemesDir);
  const syncNow = Effect.sync(bridge.syncNow);
  yield* syncNow;
  const prismDir = NodePath.dirname(bridge.settingsPath);
  if (NodeFS.existsSync(prismDir)) {
    yield* fs.watch(prismDir).pipe(
      Stream.debounce(Duration.millis(300)),
      Stream.runForEach(() => syncNow),
      Effect.ignoreCause({ log: false }),
      Effect.forkScoped,
    );
  }
  return { syncNow, status: Effect.sync(bridge.status) } satisfies PrismBridgeService["Service"];
});
export const layer = Layer.effect(PrismBridgeService, make);
