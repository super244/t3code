import { describe, expect, it } from "vite-plus/test";

import { routineScheduleLabel, routineSchedulePreset } from "./routinePresets";

describe("routine schedule presets", () => {
  it("renders common schedules in plain language", () => {
    expect(routineScheduleLabel("0 9 * * 1-5")).toBe("Weekdays at 9:00 AM");
  });

  it("keeps uncommon cron expressions editable as custom schedules", () => {
    expect(routineSchedulePreset("15 4 * * 2")).toBe("custom");
    expect(routineScheduleLabel("15 4 * * 2")).toBe("15 4 * * 2");
  });
});
