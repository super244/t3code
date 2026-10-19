/* agent-watermark: model=opus-5.5; effort=high; duration=12m; seat=claude-code; date=2026-10-19 */
import {
  type GitCommandError,
  RaceHistoryError,
  type RaceResolveBaseInput,
  type RaceResolveBaseResult,
} from "@t3tools/contracts";
import { parseRaceBranchName } from "@t3tools/shared/race";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { ExecuteGitInput, ExecuteGitResult } from "../vcs/GitVcsDriver.ts";

/**
 * The commit a race started from: the commit its branch was created at, which
 * is the oldest entry in the branch's reflog. It survives the entrant
 * committing, Keep squash-merging it, and the base branch moving on, so a
 * rematch can start from exactly where the race began.
 */
export function oldestReflogCommit(stdout: string): string | null {
  const commits = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(line));
  return commits.at(-1) ?? null;
}

export const resolveRaceBase = (
  input: RaceResolveBaseInput,
  deps: {
    readonly worktreesDir: string;
    readonly execute: (input: ExecuteGitInput) => Effect.Effect<ExecuteGitResult, GitCommandError>;
  },
): Effect.Effect<RaceResolveBaseResult, RaceHistoryError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    // Only race branches, only inside T3's own worktrees: this runs git on a
    // client-supplied path, so both are checked before anything else.
    if (!parseRaceBranchName(input.branch)) {
      return yield* new RaceHistoryError({
        operation: "resolveBase",
        detail: `${input.branch} is not a race branch.`,
      });
    }
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const canonical = (value: string) =>
      fileSystem
        .realPath(path.resolve(value))
        .pipe(Effect.orElseSucceed(() => path.resolve(value)));
    const [cwd, root] = yield* Effect.all([canonical(input.cwd), canonical(deps.worktreesDir)]);
    const relative = path.relative(root, cwd);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      return yield* new RaceHistoryError({
        operation: "resolveBase",
        detail: "The entrant's worktree must be inside T3 Code's worktrees folder.",
      });
    }
    const result = yield* deps
      .execute({
        operation: "RaceBase.reflog",
        cwd,
        args: ["reflog", "show", "--format=%H", `refs/heads/${input.branch}`, "--"],
        allowNonZeroExit: true,
        maxOutputBytes: 1_000_000,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new RaceHistoryError({
              operation: "resolveBase",
              detail: "git could not read the race branch's history.",
              cause,
            }),
        ),
      );
    return { commit: result.exitCode === 0 ? oldestReflogCommit(result.stdout) : null };
  });
