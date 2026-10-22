/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=3m; seat=codex; date=2026-10-15 */
import { describe, expect, it } from "vite-plus/test";
import type { DailyTotals } from "@t3tools/shared/usageMerge";
import { buildHeatmap } from "./UsageCalendarHeatmap";

const day = (day: string, tokens: number, cost: number): DailyTotals => ({
  day,
  totalTokens: tokens,
  costUsd: cost,
  byProvider: new Map(),
});
describe("usage calendar accounting", () => {
  it("counts recorded free or unpriced activity and includes quiet calendar days", () => {
    const days = ["2026-10-10", "2026-10-12"];
    const daily = [day(days[0]!, 100, 1), day(days[1]!, 200, 0)];
    const cost = buildHeatmap(days, daily, "cost")!;
    expect(cost.totalDays).toBe(3);
    expect(cost.activeDays).toBe(2);
    expect(cost.streak).toBe(1);
    expect(cost.weeks.flat().find((cell) => cell.day === "2026-10-12")?.hasActivity).toBe(true);
    const tokens = buildHeatmap(days, daily, "tokens")!;
    expect(tokens.activeDays).toBe(cost.activeDays);
    expect(tokens.streak).toBe(cost.streak);
  });
  it("ends the streak on an explicitly quiet last day", () => {
    const heat = buildHeatmap(["2026-10-10", "2026-10-11"], [day("2026-10-10", 100, 0)], "cost")!;
    expect(heat.activeDays).toBe(1);
    expect(heat.streak).toBe(0);
  });
});
