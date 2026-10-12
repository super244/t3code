/* agent-watermark: model=muse-spark; effort=high; duration=50m; seat=opencode; date=2026-10-07 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=34m; seat=codex; date=2026-10-04 */
import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterEach, vi } from "vite-plus/test";

import { makeCatalogBackend, makeCatalogStore, openConnectionCacheDatabase } from "./storage";

const emptyCatalog = {
  schemaVersion: 1,
  targets: [],
  profiles: [],
  credentials: [],
  remoteDpopTokens: [],
} as const;
const encodeCatalog = Schema.encodeSync(Schema.fromJsonString(ConnectionCatalogDocument));
const decodeCatalog = Schema.decodeUnknownSync(Schema.fromJsonString(ConnectionCatalogDocument));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("makeCatalogStore", () => {
  it.effect("quarantines malformed catalogs and starts from an empty document", () =>
    Effect.gen(function* () {
      const writes: string[] = [];
      const quarantined: string[] = [];
      const store = yield* makeCatalogStore({
        read: Effect.succeed("{not-json"),
        write: (raw) => Effect.sync(() => writes.push(raw)),
        quarantine: (raw) => Effect.sync(() => quarantined.push(raw)),
      });

      expect(yield* store.read).toEqual(emptyCatalog);
      expect(quarantined).toEqual(["{not-json"]);
      expect(writes).toHaveLength(1);
      expect(decodeCatalog(writes[0]!)).toEqual(emptyCatalog);
    }),
  );

  it.effect("does not hide catalog read failures", () =>
    Effect.gen(function* () {
      const failure = new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "permission denied",
      });
      const store = yield* makeCatalogStore({
        read: Effect.fail(failure),
        write: () => Effect.void,
      });

      expect(yield* Effect.flip(store.read)).toBe(failure);
    }),
  );
});

describe("makeCatalogBackend", () => {
  it.effect("fails writes when desktop secure storage declines the catalog", () =>
    Effect.gen(function* () {
      const setConnectionCatalog = vi.fn().mockResolvedValue(false);
      vi.stubGlobal("window", {
        desktopBridge: {
          getConnectionCatalog: vi.fn().mockResolvedValue(null),
          setConnectionCatalog,
        },
      });
      const backend = makeCatalogBackend({} as IDBDatabase);

      const error = yield* backend.write("{}").pipe(Effect.flip);

      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error.message).toContain("Desktop secure storage is unavailable");
      expect(setConnectionCatalog).toHaveBeenCalledWith("{}");
    }),
  );
});

describe("desktop cache recovery", () => {
  it.effect("keeps native catalogs usable when IndexedDB cannot open", () =>
    Effect.gen(function* () {
      const getConnectionCatalog = vi.fn().mockResolvedValue(encodeCatalog(emptyCatalog));
      vi.stubGlobal("window", {
        desktopBridge: {
          getConnectionCatalog,
          setConnectionCatalog: vi.fn().mockResolvedValue(true),
        },
      });
      vi.stubGlobal("indexedDB", {
        open: () => {
          const request = Object.assign(new EventTarget(), {
            error: new DOMException("Backing store locked", "UnknownError"),
          });
          queueMicrotask(() => request.dispatchEvent(new Event("error")));
          return request;
        },
      });
      const database = yield* openConnectionCacheDatabase();
      expect(database).toBeNull();
      const store = yield* makeCatalogStore(makeCatalogBackend(database));
      expect(yield* store.read).toEqual(emptyCatalog);
      expect(getConnectionCatalog).toHaveBeenCalledOnce();
    }),
  );

  it.effect("keeps browser storage failures visible without a durable native catalog", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", {});
      vi.stubGlobal("indexedDB", undefined);
      const error = yield* Effect.flip(openConnectionCacheDatabase());
      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error.message).toContain("IndexedDB is unavailable");
    }),
  );
});
