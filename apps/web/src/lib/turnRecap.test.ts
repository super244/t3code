/* agent-watermark: model=haiku-5.5; effort=high; duration=20m; seat=claude-code; date=2026-10-12 */
import { describe, expect, it } from "vite-plus/test";
import type {
  OrchestrationCheckpointSummary,
  OrchestrationLatestTurn,
  OrchestrationLatestTurnRecap,
  OrchestrationMessage,
  OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { EventId, MessageId, TurnId } from "@t3tools/contracts";

import {
  deriveTurnRecap,
  formatTurnRecapFileCount,
  summarizeSidebarTurnRecap,
  turnRecapStateLabel,
} from "./turnRecap";

const T0 = "2026-10-12T10:00:00.000Z";
const T1 = "2026-10-12T10:00:05.000Z";
const T2 = "2026-10-12T10:03:17.000Z";
const TURN = TurnId.make("turn-current");
const PREVIOUS_TURN = TurnId.make("turn-previous");

function latestTurn(overrides: Partial<OrchestrationLatestTurn> = {}): OrchestrationLatestTurn {
  return {
    turnId: TURN,
    state: "completed",
    requestedAt: T0,
    startedAt: T1,
    completedAt: T2,
    assistantMessageId: null,
    ...overrides,
  };
}

function checkpoint(
  overrides: Partial<OrchestrationCheckpointSummary> = {},
): OrchestrationCheckpointSummary {
  return {
    turnId: TURN,
    checkpointTurnCount: 2,
    checkpointRef: "refs/t3/checkpoints/current" as OrchestrationCheckpointSummary["checkpointRef"],
    status: "ready",
    files: [
      { path: "src/a.ts", kind: "modified", additions: 100, deletions: 10 },
      { path: "src/b.ts", kind: "added", additions: 20, deletions: 8 },
    ],
    assistantMessageId: null,
    completedAt: T2,
    ...overrides,
  };
}

function commandActivity(input: {
  readonly id: string;
  readonly turnId?: TurnId | null;
  readonly status?: string;
  readonly command?: string;
  readonly exitCode?: number;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(input.id),
    tone: "tool",
    kind: "tool.completed",
    summary: "Ran command",
    turnId: input.turnId === undefined ? TURN : input.turnId,
    createdAt: T2,
    payload: {
      itemType: "command_execution",
      ...(input.status === undefined ? {} : { status: input.status }),
      data: {
        item: {
          ...(input.command === undefined ? {} : { command: input.command }),
          ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
        },
      },
    },
  };
}

function message(overrides: Partial<OrchestrationMessage> = {}): OrchestrationMessage {
  return {
    id: MessageId.make("msg-final"),
    role: "assistant",
    text: "",
    turnId: TURN,
    streaming: false,
    createdAt: T2,
    updatedAt: T2,
    ...overrides,
  };
}

describe("deriveTurnRecap", () => {
  it("returns null while the latest turn is still running", () => {
    expect(
      deriveTurnRecap({
        latestTurn: latestTurn({ state: "running", completedAt: null }),
        checkpoints: [checkpoint()],
        activities: [commandActivity({ id: "a1", status: "failed", exitCode: 1 })],
        messages: [],
      }),
    ).toBeNull();
  });

  it("returns null when the thread has no latest turn", () => {
    expect(
      deriveTurnRecap({ latestTurn: null, checkpoints: [], activities: [], messages: [] }),
    ).toBeNull();
  });

  it("sums the ready checkpoint's files and reads the duration from turn timestamps", () => {
    const recap = deriveTurnRecap({
      latestTurn: latestTurn(),
      checkpoints: [checkpoint()],
      activities: [],
      messages: [],
    });
    expect(recap).not.toBeNull();
    expect(recap?.files?.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(recap?.additions).toBe(120);
    expect(recap?.deletions).toBe(18);
    // 10:00:05 to 10:03:17 is 3m 12s.
    expect(recap?.durationMs).toBe(192_000);
    expect(recap?.failedCommandCount).toBe(0);
  });

  it("keeps a no-diff turn honest: zero files, zero stats, not null", () => {
    const recap = deriveTurnRecap({
      latestTurn: latestTurn(),
      checkpoints: [checkpoint({ files: [] })],
      activities: [],
      messages: [],
    });
    expect(recap?.files).toEqual([]);
    expect(recap?.additions).toBe(0);
    expect(recap?.deletions).toBe(0);
  });

  it("leaves file stats unknown when the checkpoint is missing or errored", () => {
    for (const status of ["missing", "error"] as const) {
      const recap = deriveTurnRecap({
        latestTurn: latestTurn(),
        checkpoints: [checkpoint({ status })],
        activities: [],
        messages: [],
      });
      expect(recap?.files).toBeNull();
      expect(recap?.additions).toBeNull();
      expect(recap?.deletions).toBeNull();
    }
  });

  it("leaves file stats unknown when no checkpoint was recorded for the turn", () => {
    const recap = deriveTurnRecap({
      latestTurn: latestTurn(),
      checkpoints: [checkpoint({ turnId: PREVIOUS_TURN })],
      activities: [],
      messages: [],
    });
    expect(recap?.files).toBeNull();
  });

  it("counts a command as failed when its status is failed or its exit code is non-zero", () => {
    const recap = deriveTurnRecap({
      latestTurn: latestTurn(),
      checkpoints: [checkpoint()],
      activities: [
        commandActivity({ id: "ok", status: "completed", command: "bun test", exitCode: 0 }),
        commandActivity({ id: "bad", status: "completed", command: "bun lint", exitCode: 2 }),
        commandActivity({ id: "fail", status: "failed", command: "bun run build" }),
        commandActivity({ id: "declined", status: "declined", command: "rm -rf dist" }),
      ],
      messages: [],
    });
    expect(recap?.failedCommandCount).toBe(2);
    expect(recap?.commands.map((command) => [command.label, command.failed])).toEqual([
      ["bun test", false],
      ["bun lint", true],
      ["bun run build", true],
      ["rm -rf dist", false],
    ]);
    expect(recap?.commands[1]?.exitCode).toBe(2);
    expect(recap?.commands[0]?.exitCode).toBe(0);
    expect(recap?.commands[2]?.exitCode).toBeNull();
  });

  it("ignores commands from other turns and non-command tool activity", () => {
    const recap = deriveTurnRecap({
      latestTurn: latestTurn(),
      checkpoints: [checkpoint()],
      activities: [
        commandActivity({ id: "old", turnId: PREVIOUS_TURN, status: "failed" }),
        {
          id: EventId.make("read"),
          tone: "tool",
          kind: "tool.completed",
          summary: "Read file",
          turnId: TURN,
          createdAt: T2,
          payload: { itemType: "file_read", status: "failed" },
        },
      ],
      messages: [],
    });
    expect(recap?.commands).toEqual([]);
    expect(recap?.failedCommandCount).toBe(0);
  });

  it("takes the first meaningful line of the assistant message the turn settled on", () => {
    const recap = deriveTurnRecap({
      latestTurn: latestTurn({ assistantMessageId: MessageId.make("msg-final") }),
      checkpoints: [checkpoint()],
      activities: [],
      messages: [
        message({ id: MessageId.make("msg-earlier"), text: "Earlier reply" }),
        message({ text: "\n## Shipped the recap popover\n\nDetails follow." }),
      ],
    });
    expect(recap?.finalMessageFirstLine).toBe("Shipped the recap popover");
  });

  it("falls back to the turn's last assistant message and reports null when there is none", () => {
    const withFallback = deriveTurnRecap({
      latestTurn: latestTurn(),
      checkpoints: [checkpoint()],
      activities: [],
      messages: [message({ text: "Fallback line" })],
    });
    expect(withFallback?.finalMessageFirstLine).toBe("Fallback line");

    const withoutMessage = deriveTurnRecap({
      latestTurn: latestTurn(),
      checkpoints: [checkpoint()],
      activities: [],
      messages: [],
    });
    expect(withoutMessage?.finalMessageFirstLine).toBeNull();
  });

  it("omits the duration when the turn never recorded a start", () => {
    const recap = deriveTurnRecap({
      latestTurn: latestTurn({ startedAt: null }),
      checkpoints: [checkpoint()],
      activities: [],
      messages: [],
    });
    expect(recap?.durationMs).toBeNull();
  });
});

function recapShell(
  overrides: Partial<OrchestrationLatestTurnRecap> = {},
): OrchestrationLatestTurnRecap {
  return {
    turnId: TURN,
    fileCount: 4,
    additions: 120,
    deletions: 18,
    failedCommandCount: 0,
    ...overrides,
  };
}

describe("summarizeSidebarTurnRecap", () => {
  it("renders the row line from files, stats and duration", () => {
    const summary = summarizeSidebarTurnRecap({
      recap: recapShell(),
      latestTurn: latestTurn(),
    });
    expect(summary?.filesLabel).toBe("4 files");
    expect(summary?.durationLabel).toBe("3m 12s");
  });

  it("adds the failed-command marker and uses singular forms", () => {
    const summary = summarizeSidebarTurnRecap({
      recap: recapShell({ fileCount: 1, additions: 3, deletions: 0, failedCommandCount: 1 }),
      latestTurn: latestTurn({ state: "error" }),
    });
    expect(summary?.filesLabel).toBe("1 file");
    expect(summary?.failedCommandCount).toBe(1);
  });

  it("says a no-diff turn had no file changes and drops the empty stat", () => {
    const summary = summarizeSidebarTurnRecap({
      recap: recapShell({ fileCount: 0, additions: 0, deletions: 0 }),
      latestTurn: latestTurn(),
    });
    expect(summary?.filesLabel).toBe("No file changes");
  });

  it("omits what is unknown instead of estimating it", () => {
    const summary = summarizeSidebarTurnRecap({
      recap: recapShell({ fileCount: null, additions: null, deletions: null }),
      latestTurn: latestTurn({ startedAt: null }),
    });
    expect(summary).toBeNull();

    const onlyDuration = summarizeSidebarTurnRecap({
      recap: recapShell({ fileCount: null, additions: null, deletions: null }),
      latestTurn: latestTurn(),
    });
    expect(onlyDuration?.filesLabel).toBeNull();
    expect(onlyDuration?.durationLabel).toBe("3m 12s");
  });

  it("shows nothing for a running turn or when no recap was sent", () => {
    expect(
      summarizeSidebarTurnRecap({
        recap: recapShell(),
        latestTurn: latestTurn({ state: "running", completedAt: null }),
      }),
    ).toBeNull();
    expect(summarizeSidebarTurnRecap({ recap: null, latestTurn: latestTurn() })).toBeNull();
    expect(summarizeSidebarTurnRecap({ recap: undefined, latestTurn: latestTurn() })).toBeNull();
  });
});

describe("recap labels", () => {
  it("pluralizes file counts and names every settled turn state", () => {
    expect(formatTurnRecapFileCount(0)).toBe("No file changes");
    expect(formatTurnRecapFileCount(1)).toBe("1 file");
    expect(formatTurnRecapFileCount(7)).toBe("7 files");
    expect(turnRecapStateLabel("completed")).toBe("Completed");
    expect(turnRecapStateLabel("interrupted")).toBe("Interrupted");
    expect(turnRecapStateLabel("error")).toBe("Failed");
  });
});
