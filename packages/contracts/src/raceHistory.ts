/* agent-watermark: model=opus-5.5; effort=high; duration=32m; seat=claude-code; date=2026-10-19 */
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/**
 * Race history is the one piece of race state that must outlive the race: a
 * race lives in its entrants' branch names, and Keep deletes the losers. Each
 * finished race leaves one record so the scoreboard can say which agent wins
 * which kind of task. Records live on the server, next to the threads.
 */

/** `open`: judged but not decided yet. `kept`: a winner was merged. `none`: no entrant was worth keeping. */
export const RaceHistoryOutcome = Schema.Literals(["open", "kept", "none"]);
export type RaceHistoryOutcome = typeof RaceHistoryOutcome.Type;

export const RaceTaskKind = Schema.Literals([
  "feature",
  "fix",
  "refactor",
  "tests",
  "docs",
  "other",
]);
export type RaceTaskKind = typeof RaceTaskKind.Type;

/** `guessed` comes from the prompt's wording; `user` was picked by hand and is never overwritten. */
export const RaceTaskKindSource = Schema.Literals(["guessed", "user"]);
export type RaceTaskKindSource = typeof RaceTaskKindSource.Type;

export const RaceEntrantOutcomePhase = Schema.Literals([
  "finished",
  "failed",
  "working",
  "preparing",
  "attention",
]);
export type RaceEntrantOutcomePhase = typeof RaceEntrantOutcomePhase.Type;

const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

export const RaceHistoryEntrant = Schema.Struct({
  slot: PositiveInt,
  instanceId: TrimmedNonEmptyString,
  /** Provider driver (codex, claudeAgent, …), so instances of one harness group together. */
  driver: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  /** "Claude Haiku 5.5", "Codex GPT-6.1-Sol". */
  label: TrimmedNonEmptyString,
  phase: RaceEntrantOutcomePhase,
  elapsedMs: Schema.NullOr(NonNegativeInt),
  files: NonNegativeInt,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  /** Cost the provider itself reported for the entrant's session; null when it reports none. */
  costUsd: Schema.NullOr(NonNegativeNumber),
  failure: Schema.NullOr(Schema.String),
});
export type RaceHistoryEntrant = typeof RaceHistoryEntrant.Type;

export const RaceHistoryJudge = Schema.Struct({
  instanceId: TrimmedNonEmptyString,
  driver: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  /** The slot it picked; null when it said no entrant should be kept. */
  pickSlot: Schema.NullOr(PositiveInt),
});
export type RaceHistoryJudge = typeof RaceHistoryJudge.Type;

/**
 * A rematch: new entrants that joined a finished race on the same prompt and
 * the same base commit, decided on their own. Heat 1 is the original race and
 * lives in the record's top-level outcome fields.
 */
export const RaceHistoryHeat = Schema.Struct({
  heat: PositiveInt,
  startedAt: IsoDateTime,
  /** Slots that were in the arena when this heat was decided, champions included. */
  participants: Schema.Array(PositiveInt),
  outcome: RaceHistoryOutcome,
  keptSlot: Schema.NullOr(PositiveInt),
  judge: Schema.NullOr(RaceHistoryJudge),
});
export type RaceHistoryHeat = typeof RaceHistoryHeat.Type;

const raceHistoryRecordFields = {
  raceId: TrimmedNonEmptyString,
  projectId: ProjectId,
  projectTitle: Schema.String,
  titleSeed: Schema.String,
  prompt: Schema.String,
  taskKind: RaceTaskKind,
  taskKindSource: RaceTaskKindSource,
  startedAt: IsoDateTime,
  outcome: RaceHistoryOutcome,
  keptSlot: Schema.NullOr(PositiveInt),
  judge: Schema.NullOr(RaceHistoryJudge),
  entrants: Schema.Array(RaceHistoryEntrant),
};

export const RaceHistoryRecordInput = Schema.Struct({
  ...raceHistoryRecordFields,
  /** The commit every entrant started from, when known. */
  baseCommit: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  /** Which heat this report decides; 1 (the original race) when absent. */
  heat: Schema.optional(PositiveInt),
  heatStartedAt: Schema.optional(IsoDateTime),
  /** Slots in the arena for this heat; every reported entrant when absent. */
  participants: Schema.optional(Schema.Array(PositiveInt)),
});
export type RaceHistoryRecordInput = typeof RaceHistoryRecordInput.Type;

export const RaceHistoryRecord = Schema.Struct({
  ...raceHistoryRecordFields,
  recordedAt: IsoDateTime,
  baseCommit: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  /** Heat 1's participants; older records leave it out (every entrant took part). */
  participants: Schema.optional(Schema.Array(PositiveInt)),
  rematches: Schema.optional(Schema.Array(RaceHistoryHeat)),
});
export type RaceHistoryRecord = typeof RaceHistoryRecord.Type;

export const RaceHistoryListInput = Schema.Struct({
  limit: Schema.optional(PositiveInt),
});
export type RaceHistoryListInput = typeof RaceHistoryListInput.Type;

export const RaceHistoryListResult = Schema.Struct({
  records: Schema.Array(RaceHistoryRecord),
});
export type RaceHistoryListResult = typeof RaceHistoryListResult.Type;

export const RaceHistoryForgetInput = Schema.Struct({
  raceId: TrimmedNonEmptyString,
});
export type RaceHistoryForgetInput = typeof RaceHistoryForgetInput.Type;

export const RaceResolveBaseInput = Schema.Struct({
  /** An entrant's worktree. */
  cwd: TrimmedNonEmptyString,
  /** That entrant's race branch. */
  branch: TrimmedNonEmptyString,
});
export type RaceResolveBaseInput = typeof RaceResolveBaseInput.Type;

export const RaceResolveBaseResult = Schema.Struct({
  /** The commit the race branch was created at; null when git no longer knows. */
  commit: Schema.NullOr(TrimmedNonEmptyString),
});
export type RaceResolveBaseResult = typeof RaceResolveBaseResult.Type;

export class RaceHistoryError extends Schema.TaggedError<RaceHistoryError>()("RaceHistoryError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Race history ${this.operation} failed: ${this.detail}`;
  }
}
