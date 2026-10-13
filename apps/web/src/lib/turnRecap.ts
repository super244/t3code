/* agent-watermark: model=haiku-5.5; effort=high; duration=35m; seat=claude-code; date=2026-10-12 */
import type {
  OrchestrationCheckpointSummary,
  OrchestrationLatestTurn,
  OrchestrationLatestTurnRecap,
  OrchestrationMessage,
  OrchestrationThreadActivity,
  TurnId,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";

import type { TurnDiffFileChange } from "../types";
import { summarizeTurnDiffStats } from "./turnDiffTree";

export interface TurnRecapCommand {
  /** The command text when recorded, else the tool title, else a generic label. */
  readonly label: string;
  /** Recorded tool lifecycle status, or null when the activity carries none. */
  readonly status: string | null;
  /** Recorded exit code, or null when the provider did not record one. */
  readonly exitCode: number | null;
  readonly failed: boolean;
}

/**
 * What a settled turn did, derived from the full thread detail. Missing data stays
 * null or empty: the recap never estimates a file count, duration or exit status.
 */
export interface TurnRecap {
  readonly turnId: TurnId;
  readonly state: OrchestrationLatestTurn["state"];
  readonly durationMs: number | null;
  /** Null when the turn has no ready checkpoint, so the file list is unknown. */
  readonly files: ReadonlyArray<TurnDiffFileChange> | null;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly commands: ReadonlyArray<TurnRecapCommand>;
  readonly failedCommandCount: number;
  readonly finalMessageFirstLine: string | null;
}

/** Sidebar footer summary. Null fields are omitted from the row, never filled in. */
export interface SidebarTurnRecap {
  readonly filesLabel: string | null;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly durationLabel: string | null;
  readonly failedCommandCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function elapsedMs(startIso: string | null, endIso: string | null): number | null {
  if (startIso === null || endIso === null) return null;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function readCommandActivity(activity: OrchestrationThreadActivity): TurnRecapCommand | null {
  if (activity.kind !== "tool.completed") return null;
  const payload = asRecord(activity.payload);
  if (payload?.itemType !== "command_execution") return null;
  const data = asRecord(payload.data);
  const item = asRecord(data?.item);
  const input = asRecord(data?.input);
  const label =
    nonEmptyString(item?.command) ??
    nonEmptyString(data?.command) ??
    nonEmptyString(input?.command) ??
    nonEmptyString(payload.title) ??
    nonEmptyString(activity.summary) ??
    "Command";
  const status = nonEmptyString(payload.status);
  const exitCode = finiteNonNegative(item?.exitCode) ?? finiteNonNegative(data?.exitCode);
  const exitCodeFailed = exitCode !== null && exitCode !== 0;
  return {
    label,
    status,
    exitCode,
    failed: status === "failed" || exitCodeFailed,
  };
}

function firstLineOf(text: string): string | null {
  for (const rawLine of text.split("\n")) {
    const line = rawLine
      .trim()
      .replace(/^(#{1,6}\s+|[-*+]\s+|>\s*)/, "")
      .trim();
    if (line.length > 0) return line;
  }
  return null;
}

function resolveFinalMessage(input: {
  readonly turnId: TurnId;
  readonly assistantMessageId: string | null;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
}): string | null {
  const byId =
    input.assistantMessageId === null
      ? undefined
      : input.messages.find((message) => message.id === input.assistantMessageId);
  const message =
    byId ??
    [...input.messages]
      .reverse()
      .find((entry) => entry.role === "assistant" && entry.turnId === input.turnId);
  return message === undefined ? null : firstLineOf(message.text);
}

/**
 * Derives the recap of a thread's latest turn. Returns null while the turn is still
 * running or when there is no latest turn, so the header and sidebar show nothing
 * for work that has not settled.
 */
export function deriveTurnRecap(input: {
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
}): TurnRecap | null {
  const turn = input.latestTurn;
  if (turn === null || turn.completedAt === null || turn.state === "running") return null;

  const checkpoint = input.checkpoints.findLast((entry) => entry.turnId === turn.turnId);
  const files = checkpoint !== undefined && checkpoint.status === "ready" ? checkpoint.files : null;
  const stat = files === null ? null : summarizeTurnDiffStats(files);

  const commands: TurnRecapCommand[] = [];
  for (const activity of input.activities) {
    if (activity.turnId !== turn.turnId) continue;
    const command = readCommandActivity(activity);
    if (command !== null) commands.push(command);
  }

  return {
    turnId: turn.turnId,
    state: turn.state,
    durationMs: elapsedMs(turn.startedAt, turn.completedAt),
    files,
    additions: stat?.additions ?? null,
    deletions: stat?.deletions ?? null,
    commands,
    failedCommandCount: commands.filter((command) => command.failed).length,
    finalMessageFirstLine: resolveFinalMessage({
      turnId: turn.turnId,
      assistantMessageId: turn.assistantMessageId ?? checkpoint?.assistantMessageId ?? null,
      messages: input.messages,
    }),
  };
}

export function turnRecapStateLabel(state: OrchestrationLatestTurn["state"]): string {
  switch (state) {
    case "completed":
      return "Completed";
    case "interrupted":
      return "Interrupted";
    case "error":
      return "Failed";
    case "running":
      return "Running";
  }
}

/**
 * The screen-reader name for a command's recorded status when it is neither
 * failed nor completed. It is the same status the row prints, so the spoken and
 * printed words never disagree.
 */
export function turnRecapCommandStatusLabel(status: string | null): string {
  return status ?? "Status not recorded";
}

export function formatTurnRecapFileCount(count: number): string {
  if (count === 0) return "No file changes";
  return count === 1 ? "1 file" : `${count} files`;
}

/**
 * Sidebar summary from the shell's recap plus the shell's turn timestamps. Returns
 * null when the turn has not settled or when nothing about it is known.
 */
export function summarizeSidebarTurnRecap(input: {
  readonly recap: OrchestrationLatestTurnRecap | null | undefined;
  readonly latestTurn: OrchestrationLatestTurn | null;
}): SidebarTurnRecap | null {
  const { recap, latestTurn } = input;
  if (!recap || !latestTurn || latestTurn.completedAt === null || latestTurn.state === "running") {
    return null;
  }
  const filesLabel = recap.fileCount === null ? null : formatTurnRecapFileCount(recap.fileCount);
  const additions = recap.additions;
  const deletions = recap.deletions;
  const durationMs = elapsedMs(latestTurn.startedAt, latestTurn.completedAt);
  const durationLabel = durationMs === null ? null : formatDuration(durationMs);
  const failedCommandCount = recap.failedCommandCount;
  if (
    filesLabel === null &&
    durationLabel === null &&
    failedCommandCount === 0 &&
    additions === null
  ) {
    return null;
  }
  return {
    filesLabel,
    additions,
    deletions,
    durationLabel,
    failedCommandCount,
  };
}
