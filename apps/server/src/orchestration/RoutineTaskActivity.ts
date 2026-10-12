/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=29m; seat=codex; date=2026-10-09 */
import {
  OrchestrationLatestTurn,
  OrchestrationSessionStatus,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { ThreadBackgroundLivenessService } from "./ThreadBackgroundLiveness.ts";

class RoutineActivityError extends Data.TaggedError("RoutineActivityError")<{
  readonly cause: unknown;
}> {}

export class RoutineTaskActivity extends Context.Service<
  RoutineTaskActivity,
  {
    readonly read: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<{ readonly active: boolean }>, RoutineActivityError>;
  }
>()("t3/orchestration/RoutineTaskActivity") {}

/** Read current task state without message bodies; archived tasks can still be active. */
export const layer = Layer.effect(
  RoutineTaskActivity,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const background = yield* ThreadBackgroundLivenessService;
    const read = SqlSchema.findOneOption({
      Request: ThreadId,
      Result: Schema.Struct({
        sessionStatus: Schema.NullOr(OrchestrationSessionStatus),
        activeTurnId: Schema.NullOr(TurnId),
        turnState: Schema.NullOr(OrchestrationLatestTurn.fields.state),
      }),
      execute: (threadId) => sql`
      SELECT sessions.status AS "sessionStatus", sessions.active_turn_id AS "activeTurnId",
        turns.state AS "turnState"
      FROM projection_threads threads
      LEFT JOIN projection_thread_sessions sessions ON sessions.thread_id = threads.thread_id
      LEFT JOIN projection_turns turns
        ON turns.thread_id = threads.thread_id AND turns.turn_id = threads.latest_turn_id
      WHERE threads.thread_id = ${threadId} AND threads.deleted_at IS NULL
      LIMIT 1
    `,
    });
    return {
      read: (threadId) =>
        read(threadId).pipe(
          Effect.map((context) =>
            Option.map(context, (row) => ({
              active:
                (row.activeTurnId !== null &&
                  row.sessionStatus !== "error" &&
                  row.sessionStatus !== "interrupted" &&
                  row.sessionStatus !== "stopped") ||
                row.sessionStatus === "running" ||
                row.sessionStatus === "starting" ||
                row.turnState === "running" ||
                background.getThreadBackgroundLiveness(threadId) !== null,
            })),
          ),
          Effect.mapError((cause) => new RoutineActivityError({ cause })),
        ),
    };
  }),
);
