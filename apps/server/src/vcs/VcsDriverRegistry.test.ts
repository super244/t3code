// @effect-diagnostics nodeBuiltinImport:off
/* agent-watermark: model=opus-5; effort=high; duration=18m; seat=claude-code; date=2026-10-04 */
import * as NodeChildProcess from "node:child_process";

import { assert, it, describe } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as VcsProcess from "./VcsProcess.ts";
import * as VcsProjectConfig from "./VcsProjectConfig.ts";
import * as VcsDriverRegistry from "./VcsDriverRegistry.ts";

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const normalizeGitArgs = (args: ReadonlyArray<string>): ReadonlyArray<string> =>
  args[0] === "-C" && args.length >= 2 ? args.slice(2) : args;

describe("VcsDriverRegistry", () => {
  it.effect("routes directly by VCS driver kind for non-repository workflows", () => {
    const layer = Layer.effect(VcsDriverRegistry.VcsDriverRegistry, VcsDriverRegistry.make).pipe(
      Layer.provide(NodeServices.layer),
      Layer.provide(
        Layer.mock(VcsProjectConfig.VcsProjectConfig)({
          resolveKind: (input) => Effect.succeed(input.requestedKind ?? "auto"),
        }),
      ),
      Layer.provide(
        Layer.mock(VcsProcess.VcsProcess)({
          run: () => Effect.succeed(processOutput("")),
        }),
      ),
    );

    return Effect.gen(function* () {
      const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
      const driver = yield* registry.get("git");

      assert.strictEqual(driver.capabilities.kind, "git");
    }).pipe(Effect.provide(layer));
  });

  it.effect("caches repository detection for repeated resolves in the same cwd and kind", () => {
    const calls: VcsProcess.VcsProcessInput[] = [];
    const layer = Layer.effect(VcsDriverRegistry.VcsDriverRegistry, VcsDriverRegistry.make).pipe(
      Layer.provide(NodeServices.layer),
      Layer.provide(
        Layer.mock(VcsProjectConfig.VcsProjectConfig)({
          resolveKind: (input) => Effect.succeed(input.requestedKind ?? "auto"),
        }),
      ),
      Layer.provide(
        Layer.mock(VcsProcess.VcsProcess)({
          run: (input) =>
            Effect.sync(() => {
              calls.push(input);
              const normalizedArgs =
                input.args[0] === "-C" && input.args.length >= 2 ? input.args.slice(2) : input.args;
              const command = normalizedArgs.join(" ");
              if (command === "rev-parse --is-inside-work-tree") {
                return processOutput("true\n");
              }
              if (command === "rev-parse --show-toplevel") {
                return processOutput("/repo\n");
              }
              if (command === "rev-parse --git-common-dir") {
                return processOutput("/repo/.git\n");
              }
              return processOutput("");
            }),
        }),
      ),
    );

    return Effect.gen(function* () {
      const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
      const first = yield* registry.resolve({ cwd: "/repo", requestedKind: "git" });
      const second = yield* registry.resolve({ cwd: "/repo", requestedKind: "git" });

      assert.equal(first.repository.rootPath, "/repo");
      assert.equal(second.repository.rootPath, "/repo");
      assert.deepStrictEqual(
        calls.map((call) => normalizeGitArgs(call.args).join(" ")),
        [
          "rev-parse --is-inside-work-tree",
          "rev-parse --show-toplevel",
          "rev-parse --git-common-dir",
        ],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("detects a repository created after a negative lookup", () => {
    let insideWorkTreeChecks = 0;
    const layer = Layer.effect(VcsDriverRegistry.VcsDriverRegistry, VcsDriverRegistry.make).pipe(
      Layer.provide(NodeServices.layer),
      Layer.provide(
        Layer.mock(VcsProjectConfig.VcsProjectConfig)({
          resolveKind: (input) => Effect.succeed(input.requestedKind ?? "auto"),
        }),
      ),
      Layer.provide(
        Layer.mock(VcsProcess.VcsProcess)({
          run: (input) =>
            Effect.sync(() => {
              const command = normalizeGitArgs(input.args).join(" ");
              if (command === "rev-parse --is-inside-work-tree") {
                insideWorkTreeChecks += 1;
                return insideWorkTreeChecks === 1
                  ? {
                      ...processOutput(""),
                      exitCode: ChildProcessSpawner.ExitCode(128),
                      stderr: "fatal: not a git repository",
                    }
                  : processOutput("true\n");
              }
              if (command === "rev-parse --show-toplevel") {
                return processOutput("/repo\n");
              }
              if (command === "rev-parse --git-common-dir") {
                return processOutput("/repo/.git\n");
              }
              return processOutput("");
            }),
        }),
      ),
    );

    return Effect.gen(function* () {
      const registry = yield* VcsDriverRegistry.VcsDriverRegistry;

      assert.equal(yield* registry.detect({ cwd: "/repo" }), null);
      assert.equal((yield* registry.detect({ cwd: "/repo" }))?.repository.rootPath, "/repo");
      assert.equal(insideWorkTreeChecks, 2);
    }).pipe(Effect.provide(layer));
  });
});

// A project the user just created locally has no remote and no upstream. The
// Race composer reads its branches through detect -> listRefs, so detection must
// not depend on anything a fresh `git init` lacks.
describe("VcsDriverRegistry against real repositories", () => {
  const RealGitLayer = VcsDriverRegistry.layer.pipe(
    Layer.provideMerge(VcsProcess.layer),
    Layer.provideMerge(NodeServices.layer),
  );

  const runGit = (cwd: string, args: ReadonlyArray<string>) => {
    const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr?.trim() ?? "unknown"}`);
    }
    return result.stdout.trim();
  };

  it.effect("detects a fresh repository that has no remote", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-fresh-repo-" });
      runGit(cwd, ["init", "-b", "main"]);
      runGit(cwd, ["config", "user.email", "test@test.com"]);
      runGit(cwd, ["config", "user.name", "Test"]);
      yield* fileSystem.writeFileString(`${cwd}/calc.py`, "print(1)\n");
      runGit(cwd, ["add", "-A"]);
      runGit(cwd, ["commit", "-m", "init"]);
      assert.equal(runGit(cwd, ["remote"]), "");

      const detected = yield* registry.detect({ cwd });

      assert.equal(detected?.kind, "git");
      assert.equal(
        yield* fileSystem.realPath(detected?.repository.rootPath ?? ""),
        yield* fileSystem.realPath(cwd),
      );
    }).pipe(Effect.provide(RealGitLayer)),
  );

  it.effect("reports a directory that is not a repository as undetected", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-not-a-repo-" });

      assert.equal(yield* registry.detect({ cwd }), null);
    }).pipe(Effect.provide(RealGitLayer)),
  );
});
