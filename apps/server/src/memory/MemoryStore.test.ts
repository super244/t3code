/* agent-watermark: model=opus-5.5; effort=high; duration=4m; seat=claude-code; date=2026-10-22 */
import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { makeMemoryStore, MEMORY_FILE_NAME } from "./MemoryStore.ts";

const project = ProjectId.make("project-1");

describe("MemoryStore", () => {
  it.effect("saves, survives a reopen, edits, refuses unknown ids, and removes", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-memory-test-" });
      const store = yield* makeMemoryStore(root);
      assert.deepStrictEqual(yield* store.list(), []);

      const saved = yield* store.save({
        scope: "project",
        projectId: project,
        text: "Tests run with npm test.",
        source: "agent",
        threadId: null,
        author: "claudeAgent · claude-haiku-5-5",
      });
      const reopened = yield* makeMemoryStore(root);
      assert.deepStrictEqual(
        (yield* reopened.list()).map((entry) => entry.text),
        ["Tests run with npm test."],
      );

      const edited = yield* reopened.save({
        id: saved.id,
        scope: "global",
        projectId: null,
        text: "Prefer short answers.",
        source: "user",
        threadId: null,
        author: null,
      });
      assert.strictEqual(edited.scope, "global");
      assert.strictEqual(edited.source, "agent");

      const missing = yield* Effect.result(
        store.save({
          id: "nope",
          scope: "global",
          projectId: null,
          text: "x",
          source: "user",
          threadId: null,
          author: null,
        }),
      );
      assert.strictEqual(missing._tag, "Failure");

      assert.strictEqual(yield* store.remove(saved.id), true);
      assert.strictEqual(yield* store.remove(saved.id), false);
      assert.deepStrictEqual(yield* store.list(), []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses a corrupt memory file instead of overwriting it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-memory-test-" });
      const file = path.join(root, MEMORY_FILE_NAME);
      yield* fileSystem.writeFileString(file, "{broken");
      const store = yield* makeMemoryStore(root);
      const result = yield* Effect.result(
        store.save({
          scope: "global",
          projectId: null,
          text: "x",
          source: "user",
          threadId: null,
          author: null,
        }),
      );
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(yield* fileSystem.readFileString(file), "{broken");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
