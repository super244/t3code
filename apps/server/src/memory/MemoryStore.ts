/* agent-watermark: model=opus-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-22 */
import {
  MemoryEntry,
  MemoryError,
  type MemoryScope,
  type MemorySource,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { saveMemoryEntry } from "@t3tools/shared/memory";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";

/**
 * Persistent memory in one JSON file under the T3 home's userdata, readable
 * and fixable by hand. Writes are rare (an agent's `remember`, an edit in the
 * app), so the file is read and replaced whole under one lock.
 */
export const MEMORY_FILE_NAME = "memory.json";

const PersistedMemory = Schema.Struct({
  version: Schema.Literal(1),
  entries: Schema.Array(MemoryEntry),
});
type PersistedMemory = typeof PersistedMemory.Type;

const decodePersistedMemory = Schema.decodeUnknownEffect(Schema.fromJsonString(PersistedMemory));

const writeLocks = new Map<string, Semaphore.Semaphore>();
function lockFor(filePath: string): Semaphore.Semaphore {
  const existing = writeLocks.get(filePath);
  if (existing) return existing;
  const created = Semaphore.makeUnsafe(1);
  writeLocks.set(filePath, created);
  return created;
}

export interface MemorySaveCommand {
  readonly id?: string | undefined;
  readonly scope: MemoryScope;
  readonly projectId: ProjectId | null;
  readonly text: string;
  readonly source: MemorySource;
  readonly threadId: ThreadId | null;
  readonly author: string | null;
}

export class MemoryStore extends Context.Service<
  MemoryStore,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<MemoryEntry>, MemoryError>;
    readonly save: (command: MemorySaveCommand) => Effect.Effect<MemoryEntry, MemoryError>;
    /** Resolves false when no entry had that id. */
    readonly remove: (id: string) => Effect.Effect<boolean, MemoryError>;
  }
>()("t3/memory/MemoryStore") {}

export const makeMemoryStore = (stateDir: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const filePath = path.join(stateDir, MEMORY_FILE_NAME);
    const lock = lockFor(filePath);
    const fail = (operation: string, detail: string) => (cause: unknown) =>
      new MemoryError({ operation, detail, cause });

    const read: Effect.Effect<PersistedMemory, MemoryError> = Effect.gen(function* () {
      const exists = yield* fileSystem
        .exists(filePath)
        .pipe(Effect.mapError(fail("read", "Could not check the memory file.")));
      if (!exists) return { version: 1 as const, entries: [] };
      const raw = yield* fileSystem
        .readFileString(filePath)
        .pipe(Effect.mapError(fail("read", "Could not read the memory file.")));
      return yield* decodePersistedMemory(raw).pipe(
        Effect.mapError(fail("read", `${filePath} is not valid memory; fix or remove it.`)),
      );
    });

    const write = (memory: PersistedMemory) =>
      writeFileStringAtomically({
        filePath,
        contents: `${JSON.stringify(memory, null, 2)}\n`,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.mapError(fail("write", "Could not save the memory file.")),
      );

    const store: MemoryStore["Service"] = {
      list: () => read.pipe(Effect.map((memory) => memory.entries)),
      save: (command) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const memory = yield* read;
            const now = DateTime.formatIso(yield* DateTime.now);
            const id = yield* crypto.randomUUIDv4.pipe(
              Effect.map((uuid) => uuid.slice(0, 8)),
              Effect.mapError(fail("save", "Could not make an id.")),
            );
            const outcome = saveMemoryEntry(memory.entries, command, now, () => id);
            if (outcome.kind === "missing") {
              return yield* new MemoryError({
                operation: "save",
                detail: `No memory entry ${outcome.id}.`,
              });
            }
            if (outcome.kind === "invalid") {
              return yield* new MemoryError({ operation: "save", detail: outcome.reason });
            }
            yield* write({ version: 1, entries: outcome.entries });
            return outcome.entry;
          }),
        ),
      remove: (id) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const memory = yield* read;
            const entries = memory.entries.filter((entry) => entry.id !== id);
            if (entries.length === memory.entries.length) return false;
            yield* write({ version: 1, entries });
            return true;
          }),
        ),
    };
    return store;
  });

export const layer = Layer.effect(
  MemoryStore,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return yield* makeMemoryStore(config.stateDir);
  }),
);
