/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=35m; seat=codex; date=2026-10-02 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=3m; seat=antigravity; date=2026-10-01 */
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createRoutineDraft,
  duplicateRoutine,
  queueRoutineNow,
  ROUTINE_PROMPT_TEMPLATES,
  routineDraftIsDirty,
  routineDraftIssue,
  routineForSave,
  setRoutineEnabled,
  selectRoutines,
} from "./routines.ts";

const draft = createRoutineDraft({
  projectId: ProjectId.make("project-1"),
  instanceId: ProviderInstanceId.make("codex-work"),
  model: "gpt-6.1-sol",
  timeZone: "America/Vancouver",
})!;
const launched = {
  ...draft,
  runtimeMode: "approval-required" as const,
  interactionMode: "plan" as const,
  nextRunAt: "2026-10-02T14:00:00.000Z",
  lastRunAt: "2026-10-01T14:00:00.000Z",
  lastRunStatus: "launched" as const,
  lastThreadId: ThreadId.make("routine-thread"),
};
const available = { projectAvailable: true, providerAvailable: true, modelAvailable: true };

describe("routine editing across clients", () => {
  it("accepts extended cron syntax supported by the scheduler without using the device clock", () => {
    for (const cron of [
      "30 0 7 * * *",
      "0 0 7 1 JAN * 2010",
      "@daily",
      "0 7 L * *",
      "0 7 * * MON#2",
    ]) {
      expect(routineDraftIssue({ ...draft, cron }, available), cron).toBeNull();
    }
  });

  it("rejects out-of-range cron fields and zero intervals", () => {
    for (const cron of ["99 7 * * *", "0 25 * * *", "*/0 * * * *", "0 7 * 13 *", "0 7 * * 9"]) {
      expect(routineDraftIssue({ ...draft, cron }, available), cron).not.toBeNull();
    }
  });

  it("treats option ordering as unchanged but detects a changed model option", () => {
    const baseline = {
      ...draft,
      modelSelection: {
        ...draft.modelSelection,
        options: [
          { id: "reasoning", value: "high" },
          { id: "fast", value: true },
        ],
      },
    };
    expect(
      routineDraftIsDirty(
        {
          ...baseline,
          modelSelection: {
            ...baseline.modelSelection,
            options: baseline.modelSelection.options.toReversed(),
          },
        },
        baseline,
      ),
    ).toBe(false);
    expect(
      routineDraftIsDirty(
        {
          ...baseline,
          modelSelection: {
            ...baseline.modelSelection,
            options: [
              { id: "reasoning", value: "low" },
              { id: "fast", value: true },
            ],
          },
        },
        baseline,
      ),
    ).toBe(true);
  });

  it("requires a real project, provider instance and model before preparing a draft", () => {
    expect(createRoutineDraft({ ...draft, instanceId: undefined, model: "x" })).toBeNull();
    expect(
      createRoutineDraft({
        ...draft,
        projectId: undefined,
        instanceId: ProviderInstanceId.make("a"),
        model: "x",
      }),
    ).toBeNull();
    expect(draft.modelSelection.instanceId).toBe("codex-work");
  });

  it("copies the configuration and modes without carrying another routine's launch history", () => {
    const copy = duplicateRoutine(launched);
    expect(copy).toMatchObject({
      name: "Daily routine copy",
      modelSelection: launched.modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "plan",
      nextRunAt: null,
      lastRunAt: null,
      lastRunStatus: "never",
      lastThreadId: null,
      lastError: null,
    });
    expect(launched.lastThreadId).toBe("routine-thread");
  });

  it("saves edited instructions without overwriting a launch received while the editor was open", () => {
    const saved = routineForSave({ ...draft, prompt: "Inspect the newest diff." }, launched);
    expect(saved.prompt).toBe("Inspect the newest diff.");
    expect(saved.lastRunAt).toBe(launched.lastRunAt);
    expect(saved.lastThreadId).toBe(launched.lastThreadId);
    expect(saved.lastRunStatus).toBe("launched");
    expect(saved.nextRunAt).toBe(launched.nextRunAt);
  });

  it("recalculates changed schedules while retaining the last failure for troubleshooting", () => {
    const failed = { ...launched, lastRunStatus: "failed" as const, lastError: "Provider offline" };
    const saved = routineForSave({ ...failed, timeZone: "UTC", cron: "0 9 * * 1" }, failed);
    expect(saved.nextRunAt).toBeNull();
    expect(saved.lastError).toBe("Provider offline");
    expect(saved.lastThreadId).toBe(failed.lastThreadId);
    expect(routineForSave(launched, undefined).lastThreadId).toBeNull();
  });

  it("pauses and resumes with a fresh schedule, preserving modes and historical task links", () => {
    const paused = setRoutineEnabled(launched, false);
    expect(paused.enabled).toBe(false);
    expect(paused.nextRunAt).toBeNull();
    const resumed = setRoutineEnabled(paused, true);
    expect(resumed).toMatchObject({
      enabled: true,
      nextRunAt: null,
      lastThreadId: launched.lastThreadId,
      interactionMode: "plan",
      runtimeMode: "approval-required",
    });
  });

  it("queues one due occurrence, resumes a paused routine and preserves its previous task", () => {
    const now = Date.parse("2026-10-01T15:00:00Z");
    const queued = queueRoutineNow(
      { ...launched, enabled: false, lastError: "Previous failure" },
      now,
    );
    expect(queued).toMatchObject({
      enabled: true,
      lastRunStatus: "never",
      lastError: null,
      lastThreadId: launched.lastThreadId,
    });
    expect(Date.parse(queued.nextRunAt!)).toBeLessThan(now);
    expect(queued.cron).toBe(launched.cron);
    expect(queued.modelSelection).toEqual(launched.modelSelection);
  });

  it("treats scheduler receipts as clean while identifying unsaved configuration changes", () => {
    expect(
      routineDraftIsDirty(draft, {
        ...draft,
        lastRunStatus: "launched",
        lastThreadId: launched.lastThreadId,
      }),
    ).toBe(false);
    expect(routineDraftIsDirty({ ...draft, interactionMode: "plan" }, draft)).toBe(true);
    expect(
      routineDraftIsDirty(
        {
          ...draft,
          modelSelection: {
            ...draft.modelSelection,
            instanceId: ProviderInstanceId.make("other-account"),
          },
        },
        draft,
      ),
    ).toBe(true);
    expect(routineDraftIsDirty(draft, undefined)).toBe(true);
  });

  it("blocks unavailable project/subscription/model and malformed schedule or missing instructions", () => {
    expect(routineDraftIssue(draft, available)).toBeNull();
    for (const flag of ["projectAvailable", "providerAvailable", "modelAvailable"] as const) {
      expect(routineDraftIssue(draft, { ...available, [flag]: false })).not.toBeNull();
    }
    for (const patch of [
      { name: " " },
      { prompt: " " },
      { cron: "0 7" },
      { cron: "not a valid cron expression" },
      { timeZone: "Mars/Crater" },
    ]) {
      expect(routineDraftIssue({ ...draft, ...patch }, available)).not.toBeNull();
    }
  });

  it("exposes curated prompt presets with descriptive labels and prompts", () => {
    expect(ROUTINE_PROMPT_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const template of ROUTINE_PROMPT_TEMPLATES) {
      expect(template.label.trim().length).toBeGreaterThan(0);
      expect(template.prompt.trim().length).toBeGreaterThan(15);
    }
  });
});

describe("routine fleet focus across clients", () => {
  const routines = {
    active: { ...draft, name: "Review", lastRunStatus: "launched" as const },
    failing: { ...draft, name: "Audit", lastRunStatus: "failed" as const },
    paused: { ...draft, name: "Digest", enabled: false, prompt: "Summarize changes." },
  };
  it("keeps failed enabled routines out of Active while retaining paused failure diagnostics", () => {
    expect(selectRoutines(routines, { status: "active" }).map(([id]) => id)).toEqual(["active"]);
    expect(selectRoutines(routines, { status: "failed" }).map(([id]) => id)).toEqual(["failing"]);
    expect(selectRoutines(routines, { status: "paused" }).map(([id]) => id)).toEqual(["paused"]);
    expect(
      selectRoutines(
        { pausedFailure: { ...routines.failing, enabled: false } },
        { status: "failed" },
      ),
    ).toHaveLength(1);
  });
  it("combines status with case-insensitive prompt, cron and project searches", () => {
    expect(
      selectRoutines(routines, { status: "all", query: " SUMMARIZE " }).map(([id]) => id),
    ).toEqual(["paused"]);
    expect(selectRoutines(routines, { status: "active", query: "0 7" }).map(([id]) => id)).toEqual([
      "active",
    ]);
    expect(selectRoutines(routines, { status: "all", query: "project-1" })).toHaveLength(3);
    expect(selectRoutines(routines, { status: "active", query: "audit" })).toEqual([]);
    expect(Object.keys(routines)).toEqual(["active", "failing", "paused"]);
  });
});
