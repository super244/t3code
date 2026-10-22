/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=20m; seat=codex; date=2026-10-17 */
import { describe, it, expect } from "@effect/vitest";
import { antigravityQuotaToLimits } from "./antigravityUsageLimits.ts";
const checkedAt = "2026-10-17T16:00:00Z";
describe("Google model quota", () => {
  it("converts remaining fractions, preserves model scope and reset time", () => {
    const result = antigravityQuotaToLimits(
      {
        buckets: [
          {
            modelId: "gemini-3.8-flash-tiered",
            remainingFraction: 0.15,
            resetTime: "2026-10-18T02:00:00Z",
          },
          { modelId: "claude-opus-5-5-high", remainingFraction: 0 },
        ],
      },
      checkedAt,
    );
    expect(result.windows.find((x) => x.id === "gemini-3.8-flash-tiered")).toMatchObject({
      usedPercent: 85,
      resetsAt: "2026-10-18T02:00:00Z",
    });
    expect(result.windows.find((x) => x.id === "claude-opus-5-5-high")?.usedPercent).toBe(100);
  });
  it("does not invent headroom for missing or out-of-range quota", () => {
    const result = antigravityQuotaToLimits(
      {
        buckets: [
          { modelId: "gemini-3.8-flash" },
          { modelId: "gemini-3.6-flash", remainingFraction: 1.5 },
        ],
      },
      checkedAt,
    );
    expect(result.windows).toEqual([]);
    expect(result.unavailable?.reason).toBe("probeFailed");
  });
});
