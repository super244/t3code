/* agent-watermark: model=haiku-5.5; effort=high; duration=20m; seat=claude-code; date=2026-10-12 */
import { describe, expect, it } from "vite-plus/test";
import { parseRoutineTemplate } from "@t3tools/client-runtime/routines";

import {
  ROUTINE_EXAMPLE_TEMPLATE,
  routineScheduleLabel,
  routineSchedulePreset,
} from "./routinePresets";

describe("routine schedule presets", () => {
  it("renders common schedules in plain language", () => {
    expect(routineScheduleLabel("0 9 * * 1-5")).toBe("Weekdays at 9:00 AM");
  });

  it("keeps uncommon cron expressions editable as custom schedules", () => {
    expect(routineSchedulePreset("15 4 * * 2")).toBe("custom");
    expect(routineScheduleLabel("15 4 * * 2")).toBe("15 4 * * 2");
  });
});

describe("example routine", () => {
  it("is a valid template the import path accepts", () => {
    const template = parseRoutineTemplate(
      JSON.stringify({ ...ROUTINE_EXAMPLE_TEMPLATE, timeZone: "UTC" }),
    );
    expect(template.name).toBe("Morning triage");
    expect(template.runtimeMode).toBe("approval-required");
  });
});

describe("example routine prompt", () => {
  it("asks only for what a run can read, never T3 Code threads", () => {
    expect(ROUTINE_EXAMPLE_TEMPLATE.prompt).not.toMatch(/thread/i);
    expect(ROUTINE_EXAMPLE_TEMPLATE.prompt).toContain("git status");
  });
});
