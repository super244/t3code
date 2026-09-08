import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";

import { nextRoutineRunAt } from "./RoutineScheduler.ts";

describe("scheduled routines", () => {
  it("resolves a five-field cron in its selected time zone", () => {
    expect(
      nextRoutineRunAt(
        "30 7 * * 1-5",
        "America/Vancouver",
        DateTime.toDate(DateTime.makeUnsafe("2026-09-07T12:00:00Z")),
      ),
    ).toBe("2026-09-07T14:30:00.000Z");
  });

  it("rejects invalid cron expressions", () => {
    expect(() =>
      nextRoutineRunAt(
        "not cron",
        "UTC",
        DateTime.toDate(DateTime.makeUnsafe("2026-09-07T12:00:00Z")),
      ),
    ).toThrow();
  });
});
