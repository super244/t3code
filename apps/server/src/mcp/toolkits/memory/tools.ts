/* agent-watermark: model=opus-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-22 */
import {
  McpCapabilityUnavailableError,
  MEMORY_TEXT_MAX_CHARS,
  MemoryScope,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
];

const WHAT_TO_REMEMBER =
  "Remember lasting facts a future session in this project would otherwise have to rediscover or ask again: the user's preferences, decisions and their reasons, conventions, commands that work, and gotchas. Do not save task progress, secrets, or anything already in the repository's docs.";

export class MemoryThreadNotFoundError extends Schema.TaggedError<MemoryThreadNotFoundError>()(
  "MemoryThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

export class MemoryToolFailedError extends Schema.TaggedError<MemoryToolFailedError>()(
  "MemoryToolFailedError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export const MemoryToolError = Schema.Union([
  McpCapabilityUnavailableError,
  MemoryThreadNotFoundError,
  MemoryToolFailedError,
]);

const MemoryToolEntry = Schema.Struct({
  id: Schema.String,
  scope: MemoryScope,
  text: Schema.String,
  updatedAt: Schema.String,
});

const RememberTool = Tool.make("remember", {
  description: `${WHAT_TO_REMEMBER} One fact per call, written so it reads on its own. Saving a fact that is already remembered refreshes it instead of duplicating it. Project memory reaches every new session in this project with any agent; global memory reaches every session on this computer.`,
  parameters: Schema.Struct({
    text: TrimmedNonEmptyString.check(Schema.isMaxLength(MEMORY_TEXT_MAX_CHARS)).annotate({
      description: "The fact, in one or two sentences.",
    }),
    scope: Schema.optional(
      MemoryScope.annotate({
        description:
          'Where it applies: "project" (default) for this project only, "global" for every project, such as the user\'s personal preferences.',
      }),
    ),
  }),
  success: MemoryToolEntry,
  failure: MemoryToolError,
  dependencies,
})
  .annotate(Tool.Title, "Remember a fact")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const RecallTool = Tool.make("recall", {
  description:
    "Search persistent memory for this project and global memory, newest first. New sessions already start with the most recent entries; use this to search older ones or to check before saving.",
  parameters: Schema.Struct({
    query: Schema.optional(
      Schema.String.annotate({
        description: "Words that must all appear in an entry. Omit to list everything.",
      }),
    ),
  }),
  success: Schema.Struct({ entries: Schema.Array(MemoryToolEntry) }),
  failure: MemoryToolError,
  dependencies,
})
  .annotate(Tool.Title, "Recall memory")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ForgetTool = Tool.make("forget", {
  description:
    "Delete a memory entry that is wrong or no longer true, by the id shown in the memory brief or returned by recall. Only this project's and global entries can be forgotten.",
  parameters: Schema.Struct({ id: TrimmedNonEmptyString }),
  success: Schema.Struct({ forgotten: Schema.Boolean }),
  failure: MemoryToolError,
  dependencies,
})
  .annotate(Tool.Title, "Forget a memory")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const MemoryToolkit = Toolkit.make(RememberTool, RecallTool, ForgetTool);
