// @effect-diagnostics globalDate:off -- Tests pass fixed dates to the window builder.
import { describe, expect, it } from "vite-plus/test";

import { makeUsageWindow, USAGE_WINDOW_OPTIONS } from "./usageWindows";

describe("usage windows", () => {
  it("keeps every requested period in chronological order", () => {
    expect(USAGE_WINDOW_OPTIONS.map(({ label }) => label)).toEqual([
      "1 hr",
      "5 hr",
      "12 hr",
      "24 hr",
      "3 days",
      "7 days",
      "30 days",
      "90 days",
      "180 days",
      "1 year",
      "2 years",
      "5 years",
      "All",
    ]);
  });

  it("uses exact rolling hours for short periods", () => {
    const window = makeUsageWindow("5h", new Date("2026-09-09T20:15:48.000Z"));

    expect(window.resolution).toBe("hour");
    expect(window.sinceTime).toBe("2026-09-09T15:15:00.000Z");
    expect(window.untilTime).toBe("2026-09-09T20:15:00.000Z");
  });

  it("uses the Unix epoch for a true all-time window", () => {
    const window = makeUsageWindow("all", new Date("2026-09-09T20:15:48.000Z"));

    expect(window.sinceDay).toBe("1970-01-01");
    expect(window.resolution).toBe("day");
    expect(window.sinceTime).toBeUndefined();
    expect(window.untilTime).toBeUndefined();
  });
});
