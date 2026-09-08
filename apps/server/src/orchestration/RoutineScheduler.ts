import { CommandId, MessageId, ThreadId, type RoutineDefinition } from "@t3tools/contracts";
import { Cron } from "croner";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";

import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";

const STALE_RUN_AFTER_MS = 10 * 60 * 1_000;

class RoutineScheduleError extends Data.TaggedError("RoutineScheduleError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class RoutineScheduler extends Context.Service<
  RoutineScheduler,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration/RoutineScheduler") {}

/** Resolve the first occurrence strictly after `after`. Exported for focused tests. */
export function nextRoutineRunAt(cron: string, timeZone: string, after: Date): string {
  const schedule = new Cron(cron, { timezone: timeZone, paused: true });
  const next = schedule.nextRun(after);
  schedule.stop();
  if (next === null) throw new Error("This cron expression has no future occurrence.");
  return next.toISOString();
}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;

  const updateRoutine = Effect.fn("RoutineScheduler.updateRoutine")(function* (
    id: string,
    update: (routine: RoutineDefinition) => RoutineDefinition | null,
  ) {
    const settings = yield* settingsService.getSettings;
    const current = settings.routines[id];
    if (current === undefined) return null;
    const next = update(current);
    if (next === null) return null;
    yield* settingsService.updateSettings({ routines: { [id]: next } });
    return next;
  });

  const recordFailure = (id: string, at: string, error: unknown) =>
    updateRoutine(id, (routine) => ({
      ...routine,
      lastRunAt: at,
      lastRunStatus: "failed",
      lastError:
        error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    })).pipe(Effect.asVoid);

  const recordScheduleFailure = (id: string, error: unknown) =>
    updateRoutine(id, (routine) => ({
      ...routine,
      enabled: false,
      lastRunStatus: "failed",
      lastError:
        `Invalid schedule: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          2_000,
        ),
    })).pipe(Effect.asVoid);

  const runRoutine = Effect.fn("RoutineScheduler.runRoutine")(function* (
    id: string,
    scheduled: RoutineDefinition,
    now: Date,
  ) {
    const runAt = now.toISOString();
    const nextRunAt = nextRoutineRunAt(scheduled.cron, scheduled.timeZone, now);
    const claimed = yield* updateRoutine(id, (current) => {
      if (!current.enabled || current.nextRunAt !== scheduled.nextRunAt) return null;
      return {
        ...current,
        nextRunAt,
        lastRunAt: runAt,
        lastRunStatus: "running",
        lastError: null,
      };
    });
    if (claimed === null) return;

    const threadId = ThreadId.make(yield* crypto.randomUUIDv4);
    const commandId = CommandId.make(`server:routine:${id}:${yield* crypto.randomUUIDv4}`);
    const messageId = MessageId.make(yield* crypto.randomUUIDv4);
    yield* engine
      .dispatch({
        type: "thread.turn.start",
        commandId,
        threadId,
        message: {
          messageId,
          role: "user",
          text: claimed.prompt,
          attachments: [],
        },
        modelSelection: claimed.modelSelection,
        titleSeed: claimed.name,
        runtimeMode: claimed.runtimeMode,
        interactionMode: claimed.interactionMode,
        bootstrap: {
          createThread: {
            projectId: claimed.projectId,
            title: claimed.name,
            modelSelection: claimed.modelSelection,
            runtimeMode: claimed.runtimeMode,
            interactionMode: claimed.interactionMode,
            branch: null,
            worktreePath: null,
            createdAt: runAt,
          },
        },
        createdAt: runAt,
      })
      .pipe(
        Effect.tap(() =>
          updateRoutine(id, (current) => ({
            ...current,
            lastRunStatus: "launched",
            lastThreadId: threadId,
            lastError: null,
          })),
        ),
        Effect.catchCause((cause) =>
          recordFailure(id, runAt, Cause.squash(cause)).pipe(
            Effect.andThen(
              Effect.logWarning("scheduled routine failed", {
                routineId: id,
                cause: Cause.pretty(cause),
              }),
            ),
          ),
        ),
      );
  });

  const sweep = Effect.fn("RoutineScheduler.sweep")(function* () {
    const settings = yield* settingsService.getSettings;
    const now = DateTime.toDate(yield* DateTime.now);
    for (const [id, routine] of Object.entries(settings.routines)) {
      if (!routine.enabled) continue;
      if (routine.lastRunStatus === "running") {
        const startedAt = routine.lastRunAt === null ? Number.NaN : Date.parse(routine.lastRunAt);
        if (Number.isFinite(startedAt) && now.getTime() - startedAt < STALE_RUN_AFTER_MS) continue;

        yield* updateRoutine(id, (current) => ({
          ...current,
          nextRunAt: null,
          lastRunStatus: "failed",
          lastError: "The server stopped before this routine launch was confirmed. Rescheduling.",
        }));
        continue;
      }
      if (routine.nextRunAt === null) {
        yield* Effect.try({
          try: () => nextRoutineRunAt(routine.cron, routine.timeZone, now),
          catch: (error) =>
            new RoutineScheduleError({
              message: error instanceof Error ? error.message : "Invalid routine schedule.",
              cause: error,
            }),
        }).pipe(
          Effect.flatMap((nextRunAt) =>
            updateRoutine(id, (current) => ({
              ...current,
              nextRunAt,
              lastRunStatus: current.lastRunStatus === "failed" ? "never" : current.lastRunStatus,
              lastError: null,
            })),
          ),
          Effect.catch((error) => recordScheduleFailure(id, error)),
        );
        continue;
      }
      if (Date.parse(routine.nextRunAt) <= now.getTime()) {
        yield* Effect.try({
          try: () => nextRoutineRunAt(routine.cron, routine.timeZone, now),
          catch: (error) =>
            new RoutineScheduleError({
              message: error instanceof Error ? error.message : "Invalid routine schedule.",
              cause: error,
            }),
        }).pipe(
          Effect.flatMap(() => runRoutine(id, routine, now)),
          Effect.catch((error) => recordScheduleFailure(id, error)),
        );
      }
    }
  });

  const safeSweep = sweep().pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning("scheduled routine sweep failed", { cause: Cause.pretty(cause) }),
    ),
  );
  const worker = yield* makeDrainableWorker(() => safeSweep);
  const start: RoutineScheduler["Service"]["start"] = Effect.fn("RoutineScheduler.start")(
    function* () {
      yield* forkParked(
        Effect.gen(function* () {
          yield* worker.enqueue(undefined);
          yield* worker.drain;
        }).pipe(Effect.repeat(Schedule.spaced("30 seconds")), Effect.asVoid),
      );
    },
  );

  return { start, drain: worker.drain } satisfies RoutineScheduler["Service"];
});

export const layer = Layer.effect(RoutineScheduler, make);
