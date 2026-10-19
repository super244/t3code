/* agent-watermark: model=opus-5.5; effort=high; duration=8m; seat=claude-code; date=2026-10-19 */
import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, type RaceHistoryRecordInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { makeRaceHistoryStore, RACE_HISTORY_FILE_NAME } from "./RaceHistoryStore.ts";

const input = (overrides: Partial<RaceHistoryRecordInput> = {}): RaceHistoryRecordInput => ({
  raceId: "k3f9a2",
  projectId: ProjectId.make("project-1"),
  projectTitle: "tally",
  titleSeed: "Add a --json flag",
  prompt: "Add a --json flag",
  taskKind: "feature",
  taskKindSource: "guessed",
  startedAt: "2026-10-19T08:00:00.000Z",
  outcome: "open",
  keptSlot: null,
  judge: null,
  entrants: [
    {
      slot: 1,
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      model: "claude-haiku-5-5",
      label: "Claude Haiku 5.5",
      phase: "finished",
      elapsedMs: 24_000,
      files: 3,
      additions: 73,
      deletions: 4,
      costUsd: 0.05,
      failure: null,
    },
  ],
  ...overrides,
});

describe("RaceHistoryStore", () => {
  it.effect("starts empty, records, merges a later report, survives a reopen, and forgets", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-race-history-test-" });

      const store = yield* makeRaceHistoryStore(root);
      assert.deepStrictEqual((yield* store.list({})).records, []);

      yield* store.record(input());
      const kept = yield* store.record(input({ outcome: "kept", keptSlot: 1 }));
      assert.strictEqual(kept.outcome, "kept");

      // A judge report after the Keep must not reopen the race.
      yield* store.record(
        input({
          judge: {
            instanceId: "claudeAgent",
            driver: "claudeAgent",
            model: "claude-sonnet-5",
            label: "Claude Sonnet 5",
            pickSlot: 1,
          },
        }),
      );

      const reopened = yield* makeRaceHistoryStore(root);
      const { records } = yield* reopened.list({ limit: 10 });
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0]!.outcome, "kept");
      assert.strictEqual(records[0]!.judge?.pickSlot, 1);
      assert.isTrue(yield* fileSystem.exists(path.join(root, RACE_HISTORY_FILE_NAME)));

      yield* reopened.forget("k3f9a2");
      assert.deepStrictEqual((yield* store.list({})).records, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("serializes concurrent reports so none is lost", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-race-history-test-" });
      const first = yield* makeRaceHistoryStore(root);
      const second = yield* makeRaceHistoryStore(root);
      yield* Effect.all(
        ["aaaaaa", "bbbbbb", "cccccc", "dddddd"].map((raceId, index) =>
          (index % 2 === 0 ? first : second).record(input({ raceId })),
        ),
        { concurrency: "unbounded" },
      );
      const { records } = yield* first.list({});
      assert.deepStrictEqual(records.map((record) => record.raceId).toSorted(), [
        "aaaaaa",
        "bbbbbb",
        "cccccc",
        "dddddd",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses a corrupt history file instead of overwriting it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-race-history-test-" });
      const file = path.join(root, RACE_HISTORY_FILE_NAME);
      yield* fileSystem.writeFileString(file, "{not json");
      const store = yield* makeRaceHistoryStore(root);
      const result = yield* Effect.result(store.record(input()));
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(yield* fileSystem.readFileString(file), "{not json");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
