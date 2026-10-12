/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=5m; seat=codex; date=2026-10-02 */
import { describe, expect, it } from "vite-plus/test";
import { makeUsageWindow } from "./usageWindows";

const now = new Date("2026-10-02T20:15:48.000Z");

describe("mobile usage windows", () => {
  it("includes Unix-era history older than twenty years in All", () => {
    const window = makeUsageWindow("all", now);
    expect(window.sinceDay).toBe("1970-01-01");
    expect(window.sinceDay <= "2001-06-15").toBe(true);
    expect(window.resolution).toBe("day");
    expect(window.sinceTime).toBeUndefined();
    expect(window.untilTime).toBeUndefined();
  });

  it("keeps exact minute-aligned rolling hours for every short preset", () => {
    for (const [preset, hours] of [
      ["1h", 1],
      ["5h", 5],
      ["12h", 12],
      ["24h", 24],
    ] as const) {
      const window = makeUsageWindow(preset, now);
      expect(window.untilTime).toBe("2026-10-02T20:15:00.000Z");
      expect(Date.parse(window.untilTime!) - Date.parse(window.sinceTime!)).toBe(hours * 3_600_000);
      expect(window.resolution).toBe("hour");
    }
  });

  it("keeps both calendar-day endpoints in every longer preset", () => {
    for (const [preset, days] of [
      ["3d", 3],
      ["7d", 7],
      ["30d", 30],
      ["90d", 90],
      ["180d", 180],
      ["1y", 365],
      ["2y", 730],
      ["5y", 1825],
    ] as const) {
      const window = makeUsageWindow(preset, now);
      expect((Date.parse(window.untilDay) - Date.parse(window.sinceDay)) / 86_400_000 + 1).toBe(
        days,
      );
      expect(window.resolution).toBe("day");
    }
  });
});
