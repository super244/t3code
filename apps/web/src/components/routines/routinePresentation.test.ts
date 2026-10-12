/* agent-watermark: model=grok-4.7; effort=default; duration=18m; seat=cursor; date=2026-09-30 */
import { describe, expect, it } from "vite-plus/test";

import {
  formatRoutineTime,
  ROUTINE_STATUS,
  routineConfigurationIssue,
  routineListSubtitle,
} from "./routinePresentation";

describe("routine presentation", () => {
  it("uses human-readable run states", () => {
    expect(ROUTINE_STATUS.never.label).toBe("Not run");
    expect(ROUTINE_STATUS.running.label).toBe("Starting");
    expect(ROUTINE_STATUS.launched.label).toBe("Launched");
    expect(ROUTINE_STATUS.failed.label).toBe("Failed");
  });

  it("formats absent and malformed timestamps safely", () => {
    expect(formatRoutineTime(null)).toBe("Not yet");
    expect(formatRoutineTime("not-a-date")).toBe("Unknown");
  });

  it("explains stale routine configuration in recovery order", () => {
    const valid = {
      projectAvailable: true,
      providerAvailable: true,
      modelAvailable: true,
      timeZone: "America/Vancouver",
    };

    expect(routineConfigurationIssue(valid)).toBeNull();
    expect(routineConfigurationIssue({ ...valid, projectAvailable: false })).toContain("project");
    expect(routineConfigurationIssue({ ...valid, providerAvailable: false })).toContain(
      "provider subscription",
    );
    expect(routineConfigurationIssue({ ...valid, modelAvailable: false })).toContain("model");
    expect(routineConfigurationIssue({ ...valid, timeZone: "Mars/Olympus" })).toContain(
      "IANA time zone",
    );
  });

  it("puts the next operational fact on the routine list", () => {
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    const base = {
      cron: "0 7 * * *",
      enabled: true,
      nextRunAt: "2026-08-01T15:00:00.000Z",
      lastRunStatus: "launched" as const,
      lastError: null,
      now,
    };

    expect(routineListSubtitle(base)).toBe("Daily at 7:00 AM · in 3 hr");
    expect(routineListSubtitle({ ...base, enabled: false })).toBe("Paused · Daily at 7:00 AM");
    expect(
      routineListSubtitle({
        ...base,
        lastRunStatus: "failed",
        lastError: "The provider subscription is signed out.",
      }),
    ).toBe("Daily at 7:00 AM · The provider subscription is signed out.");
    expect(routineListSubtitle({ ...base, nextRunAt: "2026-08-01T12:00:30.000Z" })).toBe(
      "Daily at 7:00 AM · Due now",
    );
  });
});
