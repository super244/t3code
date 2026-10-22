/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=1m; seat=codex; date=2026-10-18 */
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type RoutineRunReceipt,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createRoutineDraft, makeRoutineHistoryReport, selectRoutineRuns } from "./routines.ts";

const routine = createRoutineDraft({
  projectId: ProjectId.make("project-1"),
  instanceId: ProviderInstanceId.make("codex-work"),
  model: "gpt-6.1-sol",
  timeZone: "America/Vancouver",
})!;
const receipt: RoutineRunReceipt = {
  id: "receipt-1",
  scheduledAt: "2026-10-18T14:00:00.000Z",
  startedAt: null,
  updatedAt: "2026-10-18T14:01:00.000Z",
  status: "failed",
  threadId: ThreadId.make("thread-1"),
  projectId: routine.projectId,
  modelSelection: routine.modelSelection,
  runtimeMode: routine.runtimeMode,
  interactionMode: routine.interactionMode,
  error: "Provider offline",
};
const history = {
  ...routine,
  runHistory: [
    receipt,
    {
      ...receipt,
      id: "receipt-2",
      status: "skipped" as const,
      error: null,
      skipReason: "overlap" as const,
    },
  ],
};

describe("retained routine receipt search and export", () => {
  it("combines case-insensitive words across receipt evidence with launch/outcome filters", () => {
    expect(selectRoutineRuns(history, "all", "all", "OFFLINE codex-work")).toEqual([receipt]);
    expect(selectRoutineRuns(history, "skipped", "all", "previous task")).toEqual([
      history.runHistory[1],
    ]);
    expect(selectRoutineRuns(history, "all", "completed", "offline")).toEqual([]);
    expect(selectRoutineRuns(history, "all", "unrecorded", "2026-10-18 thread-1")).toHaveLength(2);
    expect(selectRoutineRuns(history, "all", "all", "unknown text")).toEqual([]);
  });
  it("exports exactly the shown selection while keeping retention and filter scope explicit", () => {
    const input = {
      routine: history,
      routineId: "routine-1",
      environmentId: "env-1",
      exportedAt: "2026-10-18T15:00:00Z",
    };
    const report = makeRoutineHistoryReport({ ...input, filter: "failed", query: "  offline  " });
    expect(report.receipts).toEqual([receipt]);
    expect(report.selection).toEqual({ launch: "failed", outcome: "all", query: "offline" });
    expect(report.retainedCount).toBe(2);
    expect(report.matchingCount).toBe(1);
    expect(report.retainedLimit).toBe(50);
    expect(history.runHistory).toHaveLength(2);
    expect(makeRoutineHistoryReport(input).receipts).toEqual(history.runHistory);
    expect(makeRoutineHistoryReport({ ...input, query: "no match" }).matchingCount).toBe(0);
  });
});
