/* agent-watermark: model=opus-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-22 */
import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Persistent memory: short facts that outlive a thread. A project's memory
 * reaches every new agent session in that project, whatever the provider;
 * global memory reaches every session on the environment. Agents add to it
 * through the `t3-code` MCP server's memory tools, people through the app.
 */

export const MEMORY_TEXT_MAX_CHARS = 2_000;

/** `project`: one project's sessions. `global`: every session on this environment. */
export const MemoryScope = Schema.Literals(["project", "global"]);
export type MemoryScope = typeof MemoryScope.Type;

/** Who wrote it: a person in the app, or an agent through the memory tools. */
export const MemorySource = Schema.Literals(["user", "agent"]);
export type MemorySource = typeof MemorySource.Type;

const MemoryText = TrimmedNonEmptyString.check(Schema.isMaxLength(MEMORY_TEXT_MAX_CHARS));

export const MemoryEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  scope: MemoryScope,
  /** Set for project memory, null for global. */
  projectId: Schema.NullOr(ProjectId),
  text: MemoryText,
  source: MemorySource,
  /** The thread an agent saved it from; null when a person wrote it. */
  threadId: Schema.NullOr(ThreadId),
  /** "Claude Sonnet 5.5" and the like, for agent entries. */
  author: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MemoryEntry = typeof MemoryEntry.Type;

export const MemoryListInput = Schema.Struct({
  /** A project's memory plus global; every entry on the environment when absent. */
  projectId: Schema.optional(ProjectId),
});
export type MemoryListInput = typeof MemoryListInput.Type;

export const MemoryListResult = Schema.Struct({
  entries: Schema.Array(MemoryEntry),
});
export type MemoryListResult = typeof MemoryListResult.Type;

export const MemorySaveInput = Schema.Struct({
  /** Edits that entry; a new entry when absent. */
  id: Schema.optional(TrimmedNonEmptyString),
  scope: MemoryScope,
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  text: MemoryText,
});
export type MemorySaveInput = typeof MemorySaveInput.Type;

export const MemoryDeleteInput = Schema.Struct({
  id: TrimmedNonEmptyString,
});
export type MemoryDeleteInput = typeof MemoryDeleteInput.Type;

export class MemoryError extends Schema.TaggedError<MemoryError>()("MemoryError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Memory ${this.operation} failed: ${this.detail}`;
  }
}
