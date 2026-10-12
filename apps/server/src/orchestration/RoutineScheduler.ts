/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=15m; seat=codex; date=2026-10-10 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=29m; seat=codex; date=2026-10-09 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=30m; seat=codex; date=2026-10-08 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=35m; seat=codex; date=2026-10-02 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-01 */
import { CommandId, MessageId, ThreadId, type RoutineDefinition } from "@t3tools/contracts";
import {
  appendRoutineRun,
  finishRoutineRun,
  nextRoutineOccurrence,
  observeRoutineTurn,
  routineTaskIds,
  routineDailyLaunchUsage,
} from "@t3tools/shared/routines";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as RoutineTaskActivity from "./RoutineTaskActivity.ts";

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
  const next = nextRoutineOccurrence(cron, timeZone, after);
  if (next === null) throw new Error("This cron expression has no future occurrence.");
  return next;
}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  const projection = yield* Effect.serviceOption(RoutineTaskActivity.RoutineTaskActivity);

  const updateRoutine = Effect.fn("RoutineScheduler.updateRoutine")(function* (
    id: string,
    update: (routine: RoutineDefinition) => RoutineDefinition | null,
  ) {
    const result: { routine: RoutineDefinition | null } = { routine: null };
    yield* settingsService.updateSettings((settings) => {
      const current = settings.routines[id];
      if (current === undefined) return null;
      result.routine = update(current);
      return result.routine === null ? null : { routines: { [id]: result.routine } };
    });
    return result.routine;
  });

  const recordFailure = Effect.fn("RoutineScheduler.recordFailure")(function* (
    id: string,
    at: string,
    error: unknown,
  ) {
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
    yield* updateRoutine(id, (routine) =>
      routine.lastRunAt !== at || routine.lastRunStatus !== "running"
        ? null
        : finishRoutineRun({ ...routine, lastRunStatus: "failed", lastError }, at, {
            updatedAt,
            status: "failed",
            threadId: null,
            error: lastError,
          }),
    );
  });

  const recordScheduleFailure = (id: string, scheduled: RoutineDefinition, error: unknown) =>
    updateRoutine(id, (routine) =>
      !routine.enabled || routine.cron !== scheduled.cron || routine.timeZone !== scheduled.timeZone
        ? null
        : {
            ...routine,
            enabled: false,
            lastRunStatus: "failed",
            lastError:
              `Invalid schedule: ${error instanceof Error ? error.message : String(error)}`.slice(
                0,
                2_000,
              ),
          },
    ).pipe(Effect.asVoid);

  const runRoutine = Effect.fn("RoutineScheduler.runRoutine")(function* (
    id: string,
    scheduled: RoutineDefinition,
    now: Date,
  ) {
    const runAt = now.toISOString();
    const threadId = ThreadId.make(yield* crypto.randomUUIDv4);
    const checkedTasks = routineTaskIds(scheduled);
    let skipped: {
      reason: "overlap" | "activity-unavailable" | "daily-limit";
      threadId?: ThreadId;
    } | null = null;
    if (scheduled.overlapPolicy === "skip" && checkedTasks.length) {
      if (Option.isNone(projection)) skipped = { reason: "activity-unavailable" };
      else
        for (const priorThreadId of checkedTasks) {
          const activity = yield* projection.value.read(priorThreadId).pipe(
            Effect.map((context) => Option.getOrNull(context)),
            Effect.catch(() => Effect.succeed("unavailable" as const)),
          );
          if (activity === "unavailable") {
            skipped = { reason: "activity-unavailable" };
            break;
          }
          if (activity?.active) {
            skipped = { reason: "overlap", threadId: priorThreadId };
            break;
          }
        }
    }
    const claimed = yield* updateRoutine(id, (current) => {
      if (
        !current.enabled ||
        current.nextRunAt !== scheduled.nextRunAt ||
        current.lastRunStatus === "running" ||
        (current.overlapPolicy ?? "allow") !== (scheduled.overlapPolicy ?? "allow")
      )
        return null;
      if (scheduled.overlapPolicy === "skip") {
        const currentTasks = routineTaskIds(current);
        if (
          currentTasks.length !== checkedTasks.length ||
          currentTasks.some((taskId, index) => taskId !== checkedTasks[index])
        )
          return null;
      }
      const usage = routineDailyLaunchUsage(current, now);
      const limit = current.dailyLaunchLimit ?? null;
      if (limit !== null && usage.attempts >= limit) skipped = { reason: "daily-limit" };
      const dailyLaunchBudget = { ...usage, limit };
      const nextRunAt = nextRoutineOccurrence(current.cron, current.timeZone, now);
      if (skipped)
        return appendRoutineRun(
          {
            ...current,
            nextRunAt,
            enabled: nextRunAt !== null,
            lastSkippedAt: current.nextRunAt ?? runAt,
          },
          {
            id: threadId,
            scheduledAt: current.nextRunAt ?? runAt,
            startedAt: null,
            updatedAt: runAt,
            status: "skipped",
            threadId: null,
            projectId: current.projectId,
            modelSelection: current.modelSelection,
            runtimeMode: current.runtimeMode,
            interactionMode: current.interactionMode,
            error: null,
            skipReason: skipped.reason,
            dailyLaunchBudget,
            ...(skipped.threadId ? { blockingThreadId: skipped.threadId } : {}),
          },
        );
      return appendRoutineRun(
        {
          ...current,
          nextRunAt,
          enabled: nextRunAt !== null,
          dailyLaunchUsage: { ...usage, attempts: usage.attempts + 1 },
          lastRunAt: runAt,
          lastRunStatus: "running",
          lastError: null,
        },
        {
          id: threadId,
          scheduledAt: current.nextRunAt ?? runAt,
          dailyLaunchBudget: { ...dailyLaunchBudget, attempts: usage.attempts + 1 },
          startedAt: runAt,
          updatedAt: runAt,
          status: "running",
          threadId: null,
          projectId: current.projectId,
          modelSelection: current.modelSelection,
          runtimeMode: current.runtimeMode,
          interactionMode: current.interactionMode,
          error: null,
        },
      );
    });
    if (claimed === null || skipped) return;

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
        Effect.tap(({ sequence }) =>
          DateTime.now.pipe(
            Effect.flatMap((time) =>
              updateRoutine(id, (current) =>
                current.lastRunAt !== runAt || current.lastRunStatus !== "running"
                  ? null
                  : finishRoutineRun(
                      {
                        ...current,
                        lastRunStatus: "launched",
                        lastThreadId: threadId,
                        lastError: null,
                      },
                      runAt,
                      {
                        updatedAt: DateTime.formatIso(time),
                        status: "launched",
                        threadId,
                        error: null,
                        launchSequence: sequence,
                      },
                    ),
              ),
            ),
          ),
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
    // Replay bounded thread pages from durable cursors, including after a restart.
    // Do not hydrate every thread body or replace the routine's launch acknowledgement.
    const head = yield* engine.latestSequence;
    for (const [id, routine] of Object.entries(settings.routines)) {
      for (const receipt of routine.runHistory ?? []) {
        if (
          receipt.status !== "launched" ||
          receipt.outcome ||
          receipt.launchSequence === undefined ||
          !receipt.threadId
        )
          continue;
        const cursor = receipt.observedSequence ?? receipt.launchSequence;
        if (cursor >= head) continue;
        const events = yield* engine
          .readThreadEvents({
            threadId: receipt.threadId,
            fromSequenceExclusive: cursor,
            toSequenceInclusive: head,
            limit: 100,
          })
          .pipe(
            Stream.take(100),
            Stream.runCollect,
            Effect.catch((error) =>
              Effect.logWarning("routine outcome replay unavailable", {
                routineId: id,
                threadId: receipt.threadId,
                error,
              }).pipe(Effect.as([])),
            ),
          );
        const observed = observeRoutineTurn(receipt, events);
        if (observed === receipt) continue;
        yield* updateRoutine(id, (current) => {
          let matched = false;
          const runHistory = (current.runHistory ?? []).map((entry) => {
            if (
              entry.id !== receipt.id ||
              entry.threadId !== receipt.threadId ||
              entry.outcome ||
              entry.launchSequence !== receipt.launchSequence ||
              entry.observedSequence !== receipt.observedSequence
            )
              return entry;
            matched = true;
            return observed;
          });
          return matched ? { ...current, runHistory } : null;
        });
      }
    }
    const now = DateTime.toDate(yield* DateTime.now);
    for (const [id, routine] of Object.entries(settings.routines)) {
      if (routine.lastRunStatus === "running") {
        const startedAt = routine.lastRunAt === null ? Number.NaN : Date.parse(routine.lastRunAt);
        if (Number.isFinite(startedAt) && now.getTime() - startedAt < STALE_RUN_AFTER_MS) continue;

        yield* updateRoutine(id, (current) =>
          current.lastRunStatus !== "running" || current.lastRunAt !== routine.lastRunAt
            ? null
            : finishRoutineRun(
                {
                  ...current,
                  nextRunAt: null,
                  lastRunStatus: "failed",
                  lastError:
                    "The server stopped before this routine launch was confirmed. Review project history before retrying.",
                },
                routine.lastRunAt ?? "",
                {
                  updatedAt: now.toISOString(),
                  status: "failed",
                  threadId: null,
                  error:
                    "The server stopped before this routine launch was confirmed. Review project history before retrying.",
                },
              ),
        );
        continue;
      }
      if (!routine.enabled) continue;
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
            updateRoutine(id, (current) =>
              !current.enabled ||
              current.nextRunAt !== null ||
              current.cron !== routine.cron ||
              current.timeZone !== routine.timeZone
                ? null
                : {
                    ...current,
                    nextRunAt,
                  },
            ),
          ),
          Effect.catch((error) => recordScheduleFailure(id, routine, error)),
        );
        continue;
      }
      if (Date.parse(routine.nextRunAt) <= now.getTime()) {
        if (
          routine.catchUp === false &&
          now.getTime() - Date.parse(routine.nextRunAt) > 5 * 60_000
        ) {
          const nextRunAt = yield* Effect.try({
            try: () => nextRoutineOccurrence(routine.cron, routine.timeZone, now),
            catch: (error) =>
              new RoutineScheduleError({ message: "Invalid routine schedule.", cause: error }),
          }).pipe(
            Effect.catch((error) =>
              recordScheduleFailure(id, routine, error).pipe(Effect.as(null)),
            ),
          );
          const receiptId = yield* crypto.randomUUIDv4;
          yield* updateRoutine(id, (current) =>
            !current.enabled ||
            current.nextRunAt !== routine.nextRunAt ||
            current.catchUp !== false ||
            current.cron !== routine.cron ||
            current.timeZone !== routine.timeZone
              ? null
              : appendRoutineRun(
                  {
                    ...current,
                    nextRunAt,
                    enabled: nextRunAt !== null,
                    lastSkippedAt: routine.nextRunAt ?? now.toISOString(),
                  },
                  {
                    id: receiptId,
                    scheduledAt: routine.nextRunAt ?? now.toISOString(),
                    startedAt: null,
                    updatedAt: now.toISOString(),
                    status: "skipped",
                    skipReason: "missed",
                    threadId: null,
                    projectId: current.projectId,
                    modelSelection: current.modelSelection,
                    runtimeMode: current.runtimeMode,
                    interactionMode: current.interactionMode,
                    error: null,
                  },
                ),
          );
          continue;
        }
        yield* Effect.try({
          try: () => nextRoutineOccurrence(routine.cron, routine.timeZone, now),
          catch: (error) =>
            new RoutineScheduleError({
              message: error instanceof Error ? error.message : "Invalid routine schedule.",
              cause: error,
            }),
        }).pipe(
          Effect.flatMap(() => runRoutine(id, routine, now)),
          Effect.catch((error) => recordScheduleFailure(id, routine, error)),
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

export const layer = Layer.effect(
  RoutineScheduler,
  Effect.gen(function* () {
    // Production construction always supplies activity reads; older harnesses can build make directly.
    yield* RoutineTaskActivity.RoutineTaskActivity;
    return yield* make;
  }),
).pipe(Layer.provide(RoutineTaskActivity.layer));
