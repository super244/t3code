/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=7m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=2m; seat=antigravity; date=2026-10-01 */
import { describe, expect, it } from "vite-plus/test";

import {
  buildCommandCenterSummary,
  commandCenterThreadStatus,
  formatConnectionSummary,
  formatHarnessReadiness,
  sortUpcomingRoutines,
  selectMissionQueue,
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

describe("command center status labels", () => {
  it("turns empty setup counts into useful operational language", () => {
    expect(formatConnectionSummary(0, 0)).toBe("No computers added");
    expect(formatHarnessReadiness(0, 0)).toBe("Not set up");
  });

  it("distinguishes complete and partial computer connectivity", () => {
    expect(formatConnectionSummary(1, 1)).toBe("Computer connected");
    expect(formatConnectionSummary(2, 2)).toBe("All computers connected");
    expect(formatConnectionSummary(1, 2)).toBe("1 of 2 connected");
    expect(formatHarnessReadiness(1, 2)).toBe("1/2");
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

describe("mission queue", () => {
  const thread = (
    title: string,
    state: Partial<import("./commandCenter.logic").CommandCenterThreadLike>,
    updatedAt = "2026-10-01T10:00:00Z",
  ) => ({ ...idleThread, ...state, title, updatedAt });
  const rows = [
    thread("Recent work", { session: { status: "running" } }, "2026-10-01T12:00:00Z"),
    thread("Approval needed", { hasPendingApprovals: true }, "2026-10-01T01:00:00Z"),
    thread("Settled", {}),
    thread("Archived approval", { archivedAt: "2026-10-01T00:00:00Z", hasPendingApprovals: true }),
    thread("Input needed", { hasPendingUserInput: true }),
    thread("Failure", { session: { status: "error" } }),
  ];
  it("brings actionable work ahead of recent activity and excludes archives", () => {
    expect(
      selectMissionQueue(rows, "active", "", (row) => row.title).map((row) => row.title),
    ).toEqual(["Approval needed", "Input needed", "Failure", "Recent work"]);
  });
  it("isolates attention while keeping ready missions accessible in All", () => {
    expect(selectMissionQueue(rows, "attention", "", (row) => row.title)).toHaveLength(3);
    expect(selectMissionQueue(rows, "all", "", (row) => row.title).at(-1)?.title).toBe("Settled");
  });
  it("searches normalized project and computer labels without mutating source order", () => {
    const before = rows.map((row) => row.title);
    expect(
      selectMissionQueue(
        rows,
        "active",
        "  REMOTE SCHOOL  ",
        (row) => `${row.title} Remote School`,
      ),
    ).toHaveLength(4);
    expect(selectMissionQueue(rows, "attention", "unknown", (row) => row.title)).toEqual([]);
    expect(rows.map((row) => row.title)).toEqual(before);
  });
  it("filters missions by project predicate when provided", () => {
    const threadWithProject = (title: string, projectId: string) => ({
      ...idleThread,
      title,
      projectId,
      session: { status: "running" as const },
      updatedAt: "2026-10-01T10:00:00Z",
    });
    const threadsList = [
      threadWithProject("Task 1", "projA"),
      threadWithProject("Task 2", "projB"),
    ];
    expect(
      selectMissionQueue(
        threadsList,
        "active",
        "",
        (row) => row.title,
        (row) => row.projectId === "projA",
      ).map((row) => row.title),
    ).toEqual(["Task 1"]);
  });
});
