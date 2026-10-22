/* agent-watermark: model=opus-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-22 */
import type { MemoryEntry } from "@t3tools/contracts";
import { memoryForProject, searchMemory } from "@t3tools/shared/memory";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerConfig from "../../../config.ts";
import * as MemoryStore from "../../../memory/MemoryStore.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { MemoryThreadNotFoundError, MemoryToolFailedError, MemoryToolkit } from "./tools.ts";

const toolEntry = (entry: MemoryEntry) => ({
  id: entry.id,
  scope: entry.scope,
  text: entry.text,
  updatedAt: entry.updatedAt,
});

const make = Effect.gen(function* () {
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const provided = yield* Effect.serviceOption(MemoryStore.MemoryStore);
  const store = Option.isSome(provided)
    ? provided.value
    : yield* MemoryStore.makeMemoryStore((yield* ServerConfig.ServerConfig).stateDir);
  const failed = (cause: { readonly message: string }) =>
    new MemoryToolFailedError({ detail: cause.message });

  const requireThread = Effect.gen(function* () {
    const scope = yield* McpInvocationContext.requireMcpCapability("memory");
    const thread = yield* snapshots
      .getThreadShellById(scope.threadId)
      .pipe(
        Effect.mapError(() => new MemoryToolFailedError({ detail: "Could not read the thread." })),
      );
    if (Option.isNone(thread)) {
      return yield* new MemoryThreadNotFoundError({ threadId: scope.threadId });
    }
    return thread.value;
  });

  return MemoryToolkit.of({
    remember: (input) =>
      Effect.gen(function* () {
        const thread = yield* requireThread;
        const entry = yield* store
          .save({
            scope: input.scope ?? "project",
            projectId: thread.projectId,
            text: input.text,
            source: "agent",
            threadId: thread.id,
            author: `${thread.modelSelection.instanceId} · ${thread.modelSelection.model}`,
          })
          .pipe(Effect.mapError(failed));
        return toolEntry(entry);
      }),
    recall: (input) =>
      Effect.gen(function* () {
        const thread = yield* requireThread;
        const entries = yield* store.list().pipe(Effect.mapError(failed));
        return {
          entries: searchMemory(memoryForProject(entries, thread.projectId), input.query).map(
            toolEntry,
          ),
        };
      }),
    forget: (input) =>
      Effect.gen(function* () {
        const thread = yield* requireThread;
        const entries = yield* store.list().pipe(Effect.mapError(failed));
        // Another project's memory is out of reach for this thread's agent.
        const visible = memoryForProject(entries, thread.projectId).some(
          (entry) => entry.id === input.id,
        );
        if (!visible) return { forgotten: false };
        return { forgotten: yield* store.remove(input.id).pipe(Effect.mapError(failed)) };
      }),
  });
});

export const MemoryToolkitHandlersLive = MemoryToolkit.toLayer(make);
