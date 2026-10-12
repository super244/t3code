/* agent-watermark: model=haiku-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-12 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { assert, describe } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import { migrationManifest } from "./persistence/Migrations.ts";
import { readUpstreamSharedState, summarizeUpstreamSharedState } from "./upstreamSharedState.ts";

const known = migrationManifest;
const knownHead = known.reduce((max, [id]) => Math.max(max, id), 0);

describe("summarizeUpstreamSharedState", () => {
  it("reports no foreign migrations when the recorded rows match this build", () => {
    const summary = summarizeUpstreamSharedState({
      knownMigrations: known,
      recordedMigrations: known.map(([migration_id, name]) => ({ migration_id, name })),
      orchestratorV2StorePresent: false,
    });
    assert.deepStrictEqual(summary, {
      knownMigration: knownHead,
      foundMigration: knownHead,
      foreignMigrations: [],
      orchestratorV2StorePresent: false,
    });
  });

  it("lists rows this build does not define, in id order, and keeps the store flag", () => {
    const summary = summarizeUpstreamSharedState({
      knownMigrations: known,
      recordedMigrations: [
        ...known.map(([migration_id, name]) => ({ migration_id, name })),
        { migration_id: 51, name: "ProjectionThreadMessageContext" },
        { migration_id: 53, name: "PullRequestFilesViewed" },
      ],
      orchestratorV2StorePresent: true,
    });
    assert.strictEqual(summary.foundMigration, 53);
    assert.deepStrictEqual(summary.foreignMigrations, [
      "51_ProjectionThreadMessageContext",
      "53_PullRequestFilesViewed",
    ]);
    assert.isTrue(summary.orchestratorV2StorePresent);
  });

  it("treats a name mismatch on a known id as foreign", () => {
    const [id] = known[0]!;
    const summary = summarizeUpstreamSharedState({
      knownMigrations: known,
      recordedMigrations: [{ migration_id: id, name: "SomethingElse" }],
      orchestratorV2StorePresent: false,
    });
    assert.deepStrictEqual(summary.foreignMigrations, [`${id}_SomethingElse`]);
  });

  it("reports no found migration when the table cannot be read", () => {
    const summary = summarizeUpstreamSharedState({
      knownMigrations: known,
      recordedMigrations: null,
      orchestratorV2StorePresent: false,
    });
    assert.isNull(summary.foundMigration);
    assert.deepStrictEqual(summary.foreignMigrations, []);
  });
});

const stateLayer = Layer.mergeAll(SqlitePersistenceMemory, NodeServices.layer);

it.effect("reads the server's own migration table and sees foreign rows", () => {
  const stateDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "upstream-shared-"));
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const before = yield* readUpstreamSharedState({ stateDir });
    assert.strictEqual(before.foundMigration, knownHead);
    assert.deepStrictEqual(before.foreignMigrations, []);
    assert.isFalse(before.orchestratorV2StorePresent);

    // What upstream Nightly writes into a shared state.sqlite.
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${knownHead + 1}, ${"ProjectionThreadMessageContext"})`;
    NodeFS.writeFileSync(NodePath.join(stateDir, "statev2.sqlite"), "");

    const after = yield* readUpstreamSharedState({ stateDir });
    assert.strictEqual(after.foundMigration, knownHead + 1);
    assert.deepStrictEqual(after.foreignMigrations, [
      `${knownHead + 1}_ProjectionThreadMessageContext`,
    ]);
    assert.isTrue(after.orchestratorV2StorePresent);
  }).pipe(
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(stateDir, { recursive: true, force: true }))),
    Effect.provide(stateLayer),
  );
});
