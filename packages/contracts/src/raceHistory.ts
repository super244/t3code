/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=9m; seat=codex; date=2026-10-19 */
/* agent-watermark: model=opus-5.5; effort=high; duration=20m; seat=claude-code; date=2026-10-19 */
/* agent-watermark: model=opus-5.5; effort=high; duration=32m; seat=claude-code; date=2026-10-19 */
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
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
  /** Optional provenance for older records and deleted conversations. */
  threadId: Schema.optional(ThreadId),
  slot: PositiveInt,
  instanceId: TrimmedNonEmptyString,
  /** Provider driver (codex, claudeAgent, …), so instances of one harness group together. */
  driver: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  /** Reasoning effort the entrant ran with, when its model has one; a separate ladder entry. */
  effort: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  /** "Claude Haiku 5.5", "Codex GPT-6.1-Sol · high". */
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
  threadId: Schema.optional(ThreadId),
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
  offset: Schema.optional(NonNegativeInt),
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(300))),
  projectId: Schema.optional(ProjectId),
  taskKind: Schema.optional(RaceTaskKind),
  outcome: Schema.optional(RaceHistoryOutcome),
  /** Inclusive start and exclusive end, compared as instants. */
  after: Schema.optional(IsoDateTime),
  before: Schema.optional(IsoDateTime),
});
export type RaceHistoryListInput = typeof RaceHistoryListInput.Type;

/**
 * Autopilot: what a race does once every entrant has stopped, without anyone
 * watching. Any open client carries it out; each step is claimed with
 * `race.advanceAutopilot` first, so two clients never judge or keep twice.
 *
 * `waiting` → entrants still working. `judging` → a judge was started.
 * `keeping` → the judge's pick is being merged. `done` → finished (see note).
 * `stopped` → turned off by hand or something needed a person (see note).
 */
export const RaceAutopilotStage = Schema.Literals([
  "waiting",
  "judging",
  "keeping",
  "done",
  "stopped",
]);
export type RaceAutopilotStage = typeof RaceAutopilotStage.Type;

export const RaceAutopilotPlan = Schema.Struct({
  raceId: TrimmedNonEmptyString,
  /** The heat it drives: 1 for a new race, 2+ for a rematch. */
  heat: PositiveInt,
  judge: Schema.Struct({
    instanceId: TrimmedNonEmptyString,
    model: TrimmedNonEmptyString,
  }),
  /** Merge the judge's pick into the project checkout without asking. */
  keep: Schema.Boolean,
});
export type RaceAutopilotPlan = typeof RaceAutopilotPlan.Type;

export const RaceAutopilot = Schema.Struct({
  ...RaceAutopilotPlan.fields,
  stage: RaceAutopilotStage,
  /** What happened last, in a sentence: shown in the arena and the notification. */
  note: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RaceAutopilot = typeof RaceAutopilot.Type;

export const RaceAdvanceAutopilotInput = Schema.Struct({
  raceId: TrimmedNonEmptyString,
  /** The stage the caller saw; nothing changes when the stored stage differs. */
  from: RaceAutopilotStage,
  to: RaceAutopilotStage,
  note: Schema.optional(Schema.NullOr(Schema.String)),
});
export type RaceAdvanceAutopilotInput = typeof RaceAdvanceAutopilotInput.Type;

export const RaceAdvanceAutopilotResult = Schema.Struct({
  /** False when another client moved it first (or it no longer exists). */
  applied: Schema.Boolean,
  autopilot: Schema.NullOr(RaceAutopilot),
});
export type RaceAdvanceAutopilotResult = typeof RaceAdvanceAutopilotResult.Type;

export const RaceHistoryListResult = Schema.Struct({
  records: Schema.Array(RaceHistoryRecord),
  /** Additive metadata; older servers may only return records. */
  total: Schema.optional(NonNegativeInt),
  offset: Schema.optional(NonNegativeInt),
  retentionLimit: Schema.optional(PositiveInt),
  autopilots: Schema.optional(Schema.Array(RaceAutopilot)),
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
