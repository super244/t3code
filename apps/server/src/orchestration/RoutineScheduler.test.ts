/* agent-watermark: model=haiku-5.5; effort=high; duration=55m; seat=claude-code; date=2026-10-12 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=35m; seat=codex; date=2026-10-02 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-01 */
import { describe, expect, it } from "vite-plus/test";
import { it as effectIt } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ProviderInstanceId,
  type OrchestrationCommand,
  type RoutineDefinition,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import * as ServerSettings from "../serverSettings.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { make } from "./RoutineScheduler.ts";
import * as DateTime from "effect/DateTime";

import { nextRoutineRunAt } from "./RoutineScheduler.ts";

describe("scheduled routines", () => {
  it("resolves a five-field cron in its selected time zone", () => {
    expect(
      nextRoutineRunAt(
        "30 7 * * 1-5",
        "America/Vancouver",
        DateTime.toDate(DateTime.makeUnsafe("2026-09-07T12:00:00Z")),
      ),
    ).toBe("2026-09-07T14:30:00.000Z");
  });

  it("rejects invalid cron expressions", () => {
    expect(() =>
      nextRoutineRunAt(
        "not cron",
        "UTC",
        DateTime.toDate(DateTime.makeUnsafe("2026-09-07T12:00:00Z")),
      ),
    ).toThrow();
  });
});

const NOW = "2026-10-01T15:00:00.000Z";
const dueRoutine: RoutineDefinition = {
  name: "Daily review",
  enabled: true,
  cron: "0 7 * * *",
  timeZone: "America/Vancouver",
  projectId: ProjectId.make("routine-project"),
  prompt: "Original instructions",
  modelSelection: { instanceId: ProviderInstanceId.make("codex-work"), model: "test-model" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  nextRunAt: "2026-10-01T14:59:00.000Z",
  lastRunAt: null,
  lastRunStatus: "never",
  lastThreadId: null,
  lastError: null,
};

const raceAtClaim = (edit: RoutineDefinition | null, writeIndex = 1, scheduled = dueRoutine) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW));
    const settings = yield* ServerSettings.ServerSettingsService;
    const claimWaiting = yield* Deferred.make<void>();
    const releaseClaim = yield* Deferred.make<void>();
    let updates = 0;
    const commands: OrchestrationCommand[] = [];
    const scheduler = yield* make.pipe(
      Effect.provideService(ServerSettings.ServerSettingsService, {
        ...settings,
        updateSettings: (patch) =>
          Effect.gen(function* () {
            updates += 1;
            if (updates === writeIndex) {
              yield* Deferred.succeed(claimWaiting, undefined);
              yield* Deferred.await(releaseClaim);
            }
            return yield* settings.updateSettings(patch);
          }),
      }),
      Effect.provide(
        Layer.mock(OrchestrationEngineService)({
          // The sweep replays routine thread history from the engine's head before it claims.
          latestSequence: Effect.succeed(0),
          readThreadEvents: () => Stream.empty,
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return { sequence: commands.length };
            }),
        }),
      ),
    );
    yield* scheduler.start();
    yield* Deferred.await(claimWaiting);
    yield* settings.updateSettings({ routines: { daily: edit } });
    yield* Deferred.succeed(releaseClaim, undefined);
    yield* scheduler.drain;
    return { commands, routine: (yield* settings.getSettings).routines.daily };
  }).pipe(
    Effect.provide(ServerSettings.layerTest({ routines: { daily: scheduled } })),
    Effect.scoped,
  );

effectIt.layer(NodeServices.layer)("routine launch concurrency", (it) => {
  it.effect("does not recreate or launch a routine deleted while its claim is waiting", () =>
    raceAtClaim(null).pipe(
      Effect.map(({ commands, routine }) => {
        expect(commands).toEqual([]);
        expect(routine).toBeUndefined();
      }),
    ),
  );
  it.effect("does not launch a routine paused on another device while its claim is waiting", () =>
    raceAtClaim({ ...dueRoutine, enabled: false, nextRunAt: null }).pipe(
      Effect.map(({ commands, routine }) => {
        expect(commands).toEqual([]);
        expect(routine?.enabled).toBe(false);
      }),
    ),
  );
  it.effect(
    "launches the latest instructions and subscription rather than overwriting an intervening edit",
    () =>
      raceAtClaim({
        ...dueRoutine,
        name: "Edited review",
        prompt: "Newest instructions",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex-personal"),
          model: "different-model",
        },
      }).pipe(
        Effect.map(({ commands, routine }) => {
          expect(commands).toHaveLength(1);
          expect(commands[0]).toMatchObject({
            type: "thread.turn.start",
            message: { text: "Newest instructions" },
            modelSelection: { instanceId: "codex-personal", model: "different-model" },
          });
          expect(routine?.name).toBe("Edited review");
          expect(routine?.lastRunStatus).toBe("launched");
        }),
      ),
  );
});

effectIt.layer(NodeServices.layer)("routine scheduler state ownership", (it) => {
  it.effect("does not resurrect a deletion waiting on the launch receipt write", () =>
    raceAtClaim(null, 2).pipe(
      Effect.map(({ commands, routine }) => {
        expect(commands).toHaveLength(1);
        expect(routine).toBeUndefined();
      }),
    ),
  );
  it.effect("does not overwrite a queued retry with the previous launch receipt", () =>
    raceAtClaim(
      {
        ...dueRoutine,
        prompt: "Retry instructions",
        nextRunAt: "2026-10-01T14:59:59.000Z",
        lastRunStatus: "never",
      },
      2,
    ).pipe(
      Effect.map(({ routine }) => {
        expect(routine?.prompt).toBe("Retry instructions");
        expect(routine?.lastRunStatus).toBe("never");
        expect(routine?.nextRunAt).toBe("2026-10-01T14:59:59.000Z");
      }),
    ),
  );
  it.effect("does not replace a manual run request with a computed future schedule", () =>
    raceAtClaim(dueRoutine, 1, { ...dueRoutine, nextRunAt: null }).pipe(
      Effect.map(({ commands, routine }) => {
        expect(commands).toEqual([]);
        expect(routine?.nextRunAt).toBe(dueRoutine.nextRunAt);
      }),
    ),
  );
  it.effect("retains the last failure while recovering the next scheduled occurrence", () =>
    raceAtClaim(
      { ...dueRoutine, nextRunAt: null, lastRunStatus: "failed", lastError: "Last launch failed" },
      1,
      { ...dueRoutine, nextRunAt: null, lastRunStatus: "failed", lastError: "Last launch failed" },
    ).pipe(
      Effect.map(({ commands, routine }) => {
        expect(commands).toEqual([]);
        expect(routine?.lastRunStatus).toBe("failed");
        expect(routine?.lastError).toBe("Last launch failed");
        expect(Date.parse(routine?.nextRunAt ?? "")).toBeGreaterThan(Date.parse(NOW));
      }),
    ),
  );
});

const sweepTwice = (routine: RoutineDefinition) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW));
    const settings = yield* ServerSettings.ServerSettingsService;
    const firstSweep = yield* Deferred.make<void>();
    const secondSweep = yield* Deferred.make<void>();
    let sweeps = 0;
    const commands: OrchestrationCommand[] = [];
    const scheduler = yield* make.pipe(
      Effect.provideService(ServerSettings.ServerSettingsService, {
        ...settings,
        getSettings: settings.getSettings.pipe(
          Effect.tap(() => Deferred.succeed(sweeps++ === 0 ? firstSweep : secondSweep, undefined)),
        ),
      }),
      Effect.provide(
        Layer.mock(OrchestrationEngineService)({
          // The sweep replays routine thread history from the engine's head before it claims.
          latestSequence: Effect.succeed(0),
          readThreadEvents: () => Stream.empty,
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return { sequence: commands.length };
            }),
        }),
      ),
    );
    yield* scheduler.start();
    yield* Deferred.await(firstSweep);
    yield* scheduler.drain;
    yield* TestClock.adjust("30 seconds");
    yield* Deferred.await(secondSweep);
    yield* scheduler.drain;
    return { commands, routine: (yield* settings.getSettings).routines.daily };
  }).pipe(
    Effect.provide(ServerSettings.layerTest({ routines: { daily: routine } })),
    Effect.scoped,
  );

effectIt.layer(NodeServices.layer)("finite routine schedules", (it) => {
  it.effect("launches the final due occurrence once and pauses the exhausted schedule", () =>
    sweepTwice({ ...dueRoutine, timeZone: "UTC", cron: "0 0 15 1 10 * 2026" }).pipe(
      Effect.map(({ commands, routine }) => {
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
          type: "thread.turn.start",
          message: { text: dueRoutine.prompt },
          modelSelection: dueRoutine.modelSelection,
        });
        expect(routine).toMatchObject({
          enabled: false,
          nextRunAt: null,
          lastRunStatus: "launched",
          lastError: null,
        });
        expect(routine?.lastThreadId).not.toBeNull();
      }),
    ),
  );

  it.effect("recovers an unconfirmed launch even when its routine is paused", () =>
    sweepTwice({
      ...dueRoutine,
      enabled: false,
      lastRunStatus: "running",
      lastRunAt: "2026-10-01T14:00:00.000Z",
    }).pipe(
      Effect.map(({ commands, routine }) => {
        expect(commands).toHaveLength(0);
        expect(routine?.enabled).toBe(false);
        expect(routine?.lastRunStatus).toBe("failed");
        expect(routine?.lastError).toContain("server stopped");
      }),
    ),
  );
});
