/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=35m; seat=codex; date=2026-10-02 */
import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import { nextRoutineOccurrence, routineScheduleIssue } from "./routines.ts";

const date = (value: string | number) => DateTime.toDate(DateTime.makeUnsafe(value));

describe("routine schedules", () => {
  it("distinguishes valid exhausted schedules from invalid expressions", () => {
    const cron = "0 0 15 1 10 * 2026";
    expect(routineScheduleIssue(cron, "UTC")).toBeNull();
    expect(nextRoutineOccurrence(cron, "UTC", date("2026-10-01T14:59:59Z"))).toBe(
      "2026-10-01T15:00:00.000Z",
    );
    expect(nextRoutineOccurrence(cron, "UTC", date("2026-10-01T15:00:00Z"))).toBeNull();
  });

  it("rejects one-shot date strings and reports invalid time zones", () => {
    expect(routineScheduleIssue("2027-01-01T07:00:00Z", "UTC")).not.toBeNull();
    expect(() => nextRoutineOccurrence("2027-01-01T07:00:00Z", "UTC", date(0))).toThrow();
    expect(routineScheduleIssue("0 7 * * *", "Mars/Crater")).toContain("IANA time zone");
  });

  it("uses the selected time zone across daylight-saving changes", () => {
    expect(
      nextRoutineOccurrence("0 7 * * *", "America/Vancouver", date("2026-03-07T16:00:00Z")),
    ).toBe("2026-03-08T14:00:00.000Z");
    expect(
      nextRoutineOccurrence("30 0 7 * * *", "America/Vancouver", date("2026-03-08T13:59:59Z")),
    ).toBe("2026-03-08T14:00:30.000Z");
  });
});
