/* agent-watermark: model=grok-4.7; effort=default; duration=15m; seat=cursor; date=2026-09-30 */
/**
 * Filesystem discovery of OpenCode's global skills.
 *
 * OpenCode loads `SKILL.md` from `~/.config/opencode/skills/<name>/` and the
 * singular `skill/` directory. `XDG_CONFIG_HOME` replaces `~/.config`. Project
 * skills under `.opencode/` stay out of this inventory.
 *
 * @module provider/Drivers/OpenCodeSkills
 */
import * as NodeOS from "node:os";

import type { ServerProviderSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { parse as parseYamlDocument } from "yaml";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function openCodeGlobalSkillDirectories(
  path: Path.Path,
  environment: NodeJS.ProcessEnv,
): readonly [plural: string, singular: string] {
  const configHome = environment.XDG_CONFIG_HOME?.trim() ?? "";
  const home = environment.HOME?.trim() || environment.USERPROFILE?.trim() || NodeOS.homedir();
  const root =
    configHome.length > 0
      ? path.resolve(path.join(configHome, "opencode"))
      : path.join(home, ".config", "opencode");
  return [path.join(root, "skills"), path.join(root, "skill")];
}

function descriptionFrom(contents: string): string | undefined {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (match?.[1] === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = parseYamlDocument(match[1]);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || !("description" in parsed)) return undefined;
  const description = parsed.description;
  return typeof description === "string" && description.trim().length > 0
    ? description.trim()
    : undefined;
}

/**
 * Enumerate global OpenCode skills. The plural directory wins a name
 * collision, matching a first-root-wins scan. Unreadable roots are skipped.
 */
export const discoverOpenCodeSkills = Effect.fn("discoverOpenCodeSkills")(function* (
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<ReadonlyArray<ServerProviderSkill>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const roots = openCodeGlobalSkillDirectories(path, environment);
  const skillsByName = new Map<string, ServerProviderSkill>();

  for (const root of roots) {
    const entries = yield* fileSystem
      .readDirectory(root)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

    for (const entry of [...entries].sort()) {
      const name = entry.trim();
      if (name.length === 0 || skillsByName.has(name)) continue;
      const skillPath = path.join(root, entry, "SKILL.md");
      const contents = yield* fileSystem
        .readFileString(skillPath)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (contents === undefined) continue;
      const description = descriptionFrom(contents);
      skillsByName.set(name, {
        name,
        path: skillPath,
        enabled: true,
        scope: "user",
        ...(description ? { description } : {}),
      });
    }
  }

  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
});
