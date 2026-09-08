import { describe, expect, it } from "vite-plus/test";

import {
  buildCommandCenterSummary,
  commandCenterThreadStatus,
  sortUpcomingRoutines,
} from "./commandCenter.logic";

const idleThread = {
  archivedAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  backgroundLiveness: null,
  session: null,
} as const;

describe("commandCenterThreadStatus", () => {
  it("prioritizes user attention over a running session", () => {
    expect(
      commandCenterThreadStatus({
        ...idleThread,
        hasPendingApprovals: true,
        session: { status: "running" },
      }),
    ).toBe("approval");
  });

  it("keeps background monitoring visible after the turn settles", () => {
    expect(commandCenterThreadStatus({ ...idleThread, backgroundLiveness: "monitoring" })).toBe(
      "monitoring",
    );
  });
});

describe("buildCommandCenterSummary", () => {
  it("counts operational and attention state without archived threads", () => {
    const summary = buildCommandCenterSummary({
      threads: [
        { ...idleThread, session: { status: "running" } },
        { ...idleThread, hasPendingUserInput: true },
        { ...idleThread, archivedAt: "2026-01-01T00:00:00.000Z", session: { status: "error" } },
      ],
      providers: [
        { enabled: true, installed: true, status: "ready" },
        { enabled: true, installed: false, status: "error" },
        { enabled: false, installed: true, status: "ready" },
      ],
      routines: [
        { enabled: true, lastRunStatus: "launched" },
        { enabled: false, lastRunStatus: "failed" },
      ],
    });

    expect(summary).toEqual({
      activeMissions: 1,
      attentionItems: 1,
      readyProviders: 1,
      totalProviders: 2,
      enabledRoutines: 1,
      failedRoutines: 1,
    });
  });
});

describe("sortUpcomingRoutines", () => {
  it("orders enabled routines by next run and paused routines last", () => {
    const routine = (name: string, enabled: boolean, nextRunAt: string | null) => ({
      name,
      enabled,
      nextRunAt,
      lastRunStatus: "never" as const,
      cron: "0 7 * * *",
      timeZone: "UTC",
      projectId: "project",
      prompt: "Run",
      modelSelection: { instanceId: "codex", model: "gpt" },
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      lastRunAt: null,
      lastThreadId: null,
      lastError: null,
    });
    const rows = [
      { routine: routine("Paused", false, null) },
      { routine: routine("Later", true, "2026-02-01T00:00:00.000Z") },
      { routine: routine("Soon", true, "2026-01-01T00:00:00.000Z") },
    ];

    expect(sortUpcomingRoutines(rows).map((row) => row.routine.name)).toEqual([
      "Soon",
      "Later",
      "Paused",
    ]);
  });
});
