// @effect-diagnostics nodeBuiltinImport:off
/* agent-watermark: model=opus-5; effort=high; duration=18m; seat=claude-code; date=2026-10-04 */
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import type * as Path from "effect/Path";

/**
 * The Add Project path box opens on `~/`, so pasting an absolute path after it
 * is the most common way a path reaches us. A shell would read the result as
 * `$HOME//Users/you/code` and land under the home directory; joining does the
 * same, and because project creation may create a missing root it would quietly
 * invent `~/Users/you/code` as an empty, non-repository project. An absolute
 * path after `~/` can only have been meant as itself.
 *
 * What counts as absolute is per platform, because a looser test swallows real
 * file names: `~/x:` and a backslash-led name are ordinary files under the home
 * directory on POSIX, and a drive letter without a separator (`C:`) is
 * drive-relative even on Windows.
 */
export function isAbsoluteHomeRemainder(remainder: string, platform: string): boolean {
  if (platform === "win32") {
    return /^[a-zA-Z]:[/\\]/.test(remainder) || remainder.startsWith("\\\\");
  }
  return remainder.startsWith("/");
}

/**
 * Expand a leading `~` (or `~/…`, `~\…`) in a user-supplied path to the
 * current user's home directory. Spawned processes don't get shell
 * expansion, so env vars like `CODEX_HOME=~/.codex-work` would be passed
 * verbatim and treated as relative paths by the receiver.
 *
 * Matches the behavior of the other `expandHomePath` helpers in the
 * workspace layers and CLI bootstrap: `~` alone and both `~/` and `~\`
 * separators are handled. Returns the input unchanged if it doesn't
 * start with `~` or is empty. Does not handle `~user` (other-user)
 * expansion.
 */
export function expandHomePath(value: string): string {
  if (!value) return value;
  if (value === "~") return NodeOS.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    const remainder = value.slice(2);
    if (isAbsoluteHomeRemainder(remainder, HostProcessPlatform.defaultValue())) return remainder;
    return NodePath.join(NodeOS.homedir(), remainder);
  }
  return value;
}

/**
 * Same expansion as `expandHomePath`, but joins with a caller-supplied
 * `Path.Path` service instead of `node:path`. Use this inside Effect code that
 * already has `Path.Path` in context so the platform layer stays in control of
 * separator handling.
 */
export function expandHomePathWith(value: string, path: Path.Path): string {
  if (value === "~") {
    return NodeOS.homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    const remainder = value.slice(2);
    if (isAbsoluteHomeRemainder(remainder, HostProcessPlatform.defaultValue())) return remainder;
    return path.join(NodeOS.homedir(), remainder);
  }
  return value;
}
