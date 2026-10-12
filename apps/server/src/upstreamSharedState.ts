/* agent-watermark: model=haiku-5.5; effort=high; duration=8m; seat=claude-code; date=2026-10-12 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { UpstreamSharedState } from "@t3tools/shared/upstream";

import { migrationManifest } from "./persistence/Migrations.ts";

export interface RecordedMigration {
  readonly migration_id: number;
  readonly name: string;
}

/**
 * Compares the migrations this build defines with the rows its state database
 * recorded. A recorded row is foreign when this build has no migration with the
 * same id and name, which is what upstream Nightly leaves in a shared state.sqlite.
 */
export function summarizeUpstreamSharedState(input: {
  readonly knownMigrations: ReadonlyArray<readonly [number, string]>;
  readonly recordedMigrations: ReadonlyArray<RecordedMigration> | null;
  readonly orchestratorV2StorePresent: boolean;
}): UpstreamSharedState {
  const known = new Set(input.knownMigrations.map(([id, name]) => `${id}_${name}`));
  const recorded = input.recordedMigrations ?? [];
  return {
    knownMigration: input.knownMigrations.reduce((max, [id]) => Math.max(max, id), 0),
    foundMigration: recorded.reduce<number | null>(
      (max, row) => (max === null || row.migration_id > max ? row.migration_id : max),
      null,
    ),
    foreignMigrations: recorded
      .map((row) => `${row.migration_id}_${row.name}`)
      .filter((key) => !known.has(key)),
    orchestratorV2StorePresent: input.orchestratorV2StorePresent,
  };
}

/**
 * Reads this server's own migration table and checks for Orchestration V2's
 * store beside it. One SELECT and one stat, so it never writes. If the table
 * cannot be read, foundMigration is null instead of failing the status call.
 */
export const readUpstreamSharedState = Effect.fn("readUpstreamSharedState")(function* (input: {
  readonly stateDir: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const recordedMigrations =
    yield* sql`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`.pipe(
      Effect.option,
      Effect.map((rows) => Option.getOrNull(rows) as ReadonlyArray<RecordedMigration> | null),
    );
  const orchestratorV2StorePresent = yield* fs
    .exists(path.join(input.stateDir, "statev2.sqlite"))
    .pipe(Effect.orElseSucceed(() => false));
  return summarizeUpstreamSharedState({
    knownMigrations: migrationManifest,
    recordedMigrations,
    orchestratorV2StorePresent,
  });
});
