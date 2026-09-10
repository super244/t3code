import type {
  ProviderInstanceConfig,
  ServerProviderSkill,
  SkillInventory,
  SkillInventoryInstallation,
} from "@t3tools/contracts";
import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  CursorSettings,
  GrokSettings,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { discoverClaudeSkills } from "../provider/Drivers/ClaudeSkills.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { discoverCursorSkills } from "../provider/Drivers/CursorSkills.ts";
import { discoverGrokSkills } from "../provider/Drivers/GrokSkills.ts";
import {
  discoverAntigravitySkills,
  resolveAntigravityUserHome,
} from "../provider/Drivers/AntigravitySkills.ts";
import { deriveProviderInstanceConfigMap } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import { mergeProviderInstanceEnvironment } from "../provider/ProviderInstanceEnvironment.ts";
import { ServerSettingsService } from "../serverSettings.ts";

const decodeCodexSettings = Schema.decodeUnknownOption(CodexSettings);
const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);
const decodeCursorSettings = Schema.decodeUnknownOption(CursorSettings);
const decodeGrokSettings = Schema.decodeUnknownOption(GrokSettings);
const decodeAntigravitySettings = Schema.decodeUnknownOption(AntigravitySettings);

function harnessDisplayName(instance: ProviderInstanceConfig, fallback: string): string {
  return instance.displayName?.trim() || fallback;
}

export const readSkillInstallations = Effect.fn("SkillInventory.readSkillInstallations")(
  function* (input: {
    readonly instanceId: string;
    readonly instance: ProviderInstanceConfig;
    readonly fallbackDisplayName: string;
    readonly skills: ReadonlyArray<ServerProviderSkill>;
  }): Effect.fn.Return<
    ReadonlyArray<SkillInventoryInstallation>,
    never,
    FileSystem.FileSystem | Path.Path
  > {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const installations = yield* Effect.forEach(input.skills, (skill) =>
      fileSystem.readFileString(skill.path).pipe(
        Effect.map((content) => ({
          providerInstanceId: ProviderInstanceId.make(input.instanceId),
          harness: input.instance.driver,
          harnessDisplayName: harnessDisplayName(input.instance, input.fallbackDisplayName),
          name: skill.name,
          ...(skill.description ? { description: skill.description } : {}),
          directoryPath: path.dirname(skill.path),
          skillFilePath: skill.path,
          content,
        })),
        Effect.option,
      ),
    );
    return Arr.getSomes(installations);
  },
);

const discoverInstanceSkills = Effect.fn("SkillInventory.discoverInstanceSkills")(function* (
  instanceId: string,
  instance: ProviderInstanceConfig,
): Effect.fn.Return<
  ReadonlyArray<SkillInventoryInstallation>,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  const config = instance.config ?? {};
  const processEnv = mergeProviderInstanceEnvironment(instance.environment);

  if (instance.driver === "codex") {
    const decoded = decodeCodexSettings(config);
    if (decoded._tag === "None") return [];
    if (!(instance.enabled ?? decoded.value.enabled)) return [];
    const configuredHomePath = decoded.value.homePath || processEnv.CODEX_HOME?.trim() || "";
    const layout = yield* resolveCodexHomeLayout({
      ...decoded.value,
      homePath: configuredHomePath,
    });
    const skills = yield* discoverClaudeSkills(
      { homePath: layout.sharedHomePath },
      undefined,
      processEnv,
    );
    return yield* readSkillInstallations({
      instanceId,
      instance,
      fallbackDisplayName: "Codex",
      skills,
    });
  }

  if (instance.driver === "claudeAgent") {
    const decoded = decodeClaudeSettings(config);
    if (decoded._tag === "None") return [];
    if (!(instance.enabled ?? decoded.value.enabled)) return [];
    const skills = yield* discoverClaudeSkills(decoded.value, undefined, processEnv);
    return yield* readSkillInstallations({
      instanceId,
      instance,
      fallbackDisplayName: "Claude",
      skills,
    });
  }

  if (instance.driver === "cursor") {
    const decoded = decodeCursorSettings(config);
    if (decoded._tag === "None" || !(instance.enabled ?? decoded.value.enabled)) return [];
    const skills = yield* discoverCursorSkills(undefined, processEnv);
    return yield* readSkillInstallations({
      instanceId,
      instance,
      fallbackDisplayName: "Cursor",
      skills,
    });
  }

  if (instance.driver === "grok") {
    const decoded = decodeGrokSettings(config);
    if (decoded._tag === "None" || !(instance.enabled ?? decoded.value.enabled)) return [];
    const skills = yield* discoverGrokSkills(decoded.value, processEnv).pipe(
      Effect.orElseSucceed(() => []),
    );
    return yield* readSkillInstallations({
      instanceId,
      instance,
      fallbackDisplayName: "Grok",
      // A process without an explicit cwd still inherits the server cwd.
      // Keep this machine-level inventory free of incidental project skills.
      skills: skills.filter((skill) => skill.scope !== "project"),
    });
  }

  if (instance.driver === "antigravity") {
    const decoded = decodeAntigravitySettings(config);
    if (decoded._tag === "None" || !(instance.enabled ?? decoded.value.enabled)) return [];
    const platform = yield* HostProcessPlatform;
    const skills = yield* discoverAntigravitySkills({
      userHome: resolveAntigravityUserHome(platform, processEnv),
    }).pipe(Effect.orElseSucceed(() => []));
    return yield* readSkillInstallations({
      instanceId,
      instance,
      fallbackDisplayName: "Antigravity",
      skills,
    });
  }

  // OpenCode does not expose a compatible global skill source yet.
  return [];
});

export const discoverGlobalSkillInventory = Effect.fn(
  "SkillInventory.discoverGlobalSkillInventory",
)(function* (): Effect.fn.Return<
  SkillInventory,
  never,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ServerSettingsService
> {
  const settingsService = yield* ServerSettingsService;
  const settings = yield* settingsService.getSettings.pipe(Effect.orDie);
  const providerInstances = deriveProviderInstanceConfigMap(settings);
  const installations = yield* Effect.forEach(
    Object.entries(providerInstances),
    ([instanceId, instance]) => discoverInstanceSkills(instanceId, instance),
    { concurrency: "unbounded" },
  );

  return {
    scannedAt: DateTime.formatIso(yield* DateTime.now),
    installations: installations
      .flat()
      .sort(
        (left, right) =>
          left.harnessDisplayName.localeCompare(right.harnessDisplayName) ||
          left.name.localeCompare(right.name),
      ),
  };
});
