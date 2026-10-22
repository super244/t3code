/* agent-watermark: model=opus-5.5; effort=high; duration=20m; seat=claude-code; date=2026-10-19 */
import {
  RaceAutopilot,
  RaceHistoryError,
  RaceHistoryRecord,
  type RaceAdvanceAutopilotInput,
  type RaceAdvanceAutopilotResult,
  type RaceAutopilotPlan,
  type RaceHistoryListResult,
  type RaceHistoryRecordInput,
} from "@t3tools/contracts";
import {
  advanceRaceAutopilot,
  setRaceAutopilot,
  upsertRaceHistory,
} from "@t3tools/shared/raceHistory";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { writeFileStringAtomically } from "../atomicWrite.ts";

/**
 * Race results in one JSON file under the T3 home's userdata. Writes are rare
 * (one per race, a few more as a judge and a Keep land), so a small file read
 * and replaced whole is enough, and it stays readable by hand.
 */
export const RACE_HISTORY_FILE_NAME = "race-history.json";

const PersistedRaceHistory = Schema.Struct({
  version: Schema.Literal(1),
  records: Schema.Array(RaceHistoryRecord),
  /** Races running on autopilot; absent in files written before autopilot. */
  autopilots: Schema.optional(Schema.Array(RaceAutopilot)),
});
type PersistedRaceHistory = typeof PersistedRaceHistory.Type;

const decodePersistedRaceHistory = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PersistedRaceHistory),
);

// Every WebSocket connection builds its own store over the same file;
// serialize read-modify-write across all of them in this process.
const writeLocks = new Map<string, Semaphore.Semaphore>();
function lockFor(filePath: string): Semaphore.Semaphore {
  const existing = writeLocks.get(filePath);
  if (existing) return existing;
  const created = Semaphore.makeUnsafe(1);
  writeLocks.set(filePath, created);
  return created;
}

export interface RaceHistoryStore {
  readonly list: (input: {
    readonly limit?: number | undefined;
  }) => Effect.Effect<RaceHistoryListResult, RaceHistoryError>;
  readonly record: (
    input: RaceHistoryRecordInput,
  ) => Effect.Effect<RaceHistoryRecord, RaceHistoryError>;
  readonly forget: (raceId: string) => Effect.Effect<void, RaceHistoryError>;
  readonly setAutopilot: (
    plan: RaceAutopilotPlan,
  ) => Effect.Effect<RaceAutopilot, RaceHistoryError>;
  readonly advanceAutopilot: (
    input: RaceAdvanceAutopilotInput,
  ) => Effect.Effect<RaceAdvanceAutopilotResult, RaceHistoryError>;
}

export const makeRaceHistoryStore = (stateDir: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const filePath = path.join(stateDir, RACE_HISTORY_FILE_NAME);
    const lock = lockFor(filePath);
    const fail = (operation: string, detail: string) => (cause: unknown) =>
      new RaceHistoryError({ operation, detail, cause });

    const read: Effect.Effect<PersistedRaceHistory, RaceHistoryError> = Effect.gen(function* () {
      const exists = yield* fileSystem
        .exists(filePath)
        .pipe(Effect.mapError(fail("read", "Could not check the history file.")));
      if (!exists) return { version: 1 as const, records: [] };
      const raw = yield* fileSystem
        .readFileString(filePath)
        .pipe(Effect.mapError(fail("read", "Could not read the history file.")));
      return yield* decodePersistedRaceHistory(raw).pipe(
        Effect.mapError(fail("read", `${filePath} is not valid race history; fix or remove it.`)),
      );
    });

    const write = (history: PersistedRaceHistory) =>
      writeFileStringAtomically({
        filePath,
        contents: `${JSON.stringify(history, null, 2)}\n`,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.mapError(fail("write", "Could not save the history file.")),
      );

    const store: RaceHistoryStore = {
      list: ({ limit }) =>
        read.pipe(
          Effect.map((history) => ({
            records: limit === undefined ? history.records : history.records.slice(0, limit),
            autopilots: history.autopilots ?? [],
          })),
        ),
      record: (input) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const history = yield* read;
            const now = DateTime.formatIso(yield* DateTime.now);
            const { records, record } = upsertRaceHistory(history.records, input, now);
            yield* write({ ...history, records });
            return record;
          }),
        ),
      forget: (raceId) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const history = yield* read;
            const records = history.records.filter((record) => record.raceId !== raceId);
            const autopilots = (history.autopilots ?? []).filter(
              (autopilot) => autopilot.raceId !== raceId,
            );
            if (
              records.length === history.records.length &&
              autopilots.length === (history.autopilots ?? []).length
            ) {
              return;
            }
            yield* write({ version: 1, records, autopilots });
          }),
        ),
      setAutopilot: (plan) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const history = yield* read;
            const now = DateTime.formatIso(yield* DateTime.now);
            const { autopilots, autopilot } = setRaceAutopilot(history.autopilots ?? [], plan, now);
            yield* write({ ...history, autopilots });
            return autopilot;
          }),
        ),
      advanceAutopilot: (input) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const history = yield* read;
            const now = DateTime.formatIso(yield* DateTime.now);
            const { autopilots, applied, autopilot } = advanceRaceAutopilot(
              history.autopilots ?? [],
              input,
              now,
            );
            if (applied) yield* write({ ...history, autopilots });
            return { applied, autopilot };
          }),
        ),
    };
    return store;
  });
