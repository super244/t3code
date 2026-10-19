/* agent-watermark: model=opus-5.5; effort=high; duration=8m; seat=claude-code; date=2026-10-19 */
// @effect-diagnostics nodeBuiltinImport:off
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import type { ExecuteGitInput } from "../vcs/GitVcsDriver.ts";
import { oldestReflogCommit, resolveRaceBase } from "./raceBase.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();

// The real command, run the way GitVcsDriver.execute would run it.
const execute = (input: ExecuteGitInput) =>
  Effect.sync(() => {
    const result = spawnSync("git", [...input.args], { cwd: input.cwd, encoding: "utf8" });
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: false,
      stderrTruncated: false,
    } as never;
  });

function raceRepo() {
  const root = mkdtempSync(join(tmpdir(), "t3-race-base-"));
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  mkdirSync(repo);
  mkdirSync(worktrees);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  const base = git(repo, "rev-parse", "HEAD");
  const branch = "t3code/race-k3f9a2-1of2";
  const worktree = join(worktrees, "repo", "race-1");
  git(repo, "worktree", "add", "-q", "-b", branch, worktree, base);
  // The entrant commits, and the base branch moves on (as Keep would move it).
  writeFileSync(join(worktree, "b.txt"), "b\n");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-qm", "entrant work");
  writeFileSync(join(repo, "c.txt"), "c\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "main moved");
  return { root, worktrees, worktree, branch, base };
}

describe("resolveRaceBase", () => {
  it.effect("finds the commit the race branch started from after it and main both moved", () =>
    Effect.gen(function* () {
      const { worktrees, worktree, branch, base } = raceRepo();
      const result = yield* resolveRaceBase(
        { cwd: worktree, branch },
        { worktreesDir: worktrees, execute },
      );
      assert.strictEqual(result.commit, base);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses a path outside T3's worktrees and a branch that is not a race's", () =>
    Effect.gen(function* () {
      const { root, worktrees, worktree, branch } = raceRepo();
      const outside = yield* Effect.result(
        resolveRaceBase({ cwd: join(root, "repo"), branch }, { worktreesDir: worktrees, execute }),
      );
      assert.strictEqual(outside._tag, "Failure");
      const notRace = yield* Effect.result(
        resolveRaceBase({ cwd: worktree, branch: "main" }, { worktreesDir: worktrees, execute }),
      );
      assert.strictEqual(notRace._tag, "Failure");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it("reads the oldest commit from reflog output and ignores noise", () => {
    const newest = "a".repeat(40);
    const oldest = "b".repeat(40);
    assert.strictEqual(oldestReflogCommit(`${newest}\n${oldest}\n`), oldest);
    assert.strictEqual(oldestReflogCommit("fatal: bad ref\n"), null);
  });
});
