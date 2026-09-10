import { describe, expect, it } from "vite-plus/test";

import {
  formatRoutineTime,
  ROUTINE_STATUS,
  routineConfigurationIssue,
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
});
