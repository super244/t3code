/* agent-watermark: model=opus-5.5; effort=high; duration=5m; seat=claude-code; date=2026-10-22 */
import { describe, expect, it } from "vite-plus/test";

import { nextRaceAutopilotStep, type RaceAutopilotInput } from "./raceAutopilot.logic";

const finished = (slot: number, files = 2) =>
  ({ slot, phase: "finished", loaded: true, files }) as const;

const input = (overrides: Partial<RaceAutopilotInput> = {}): RaceAutopilotInput => ({
  stage: "waiting",
  keep: true,
  decided: false,
  entrants: [finished(1), finished(2)],
  judge: null,
  judgeReady: true,
  judgeLabel: "Claude Sonnet 5.5",
  ...overrides,
});

describe("nextRaceAutopilotStep", () => {
  it("waits while any entrant works or its final diff is unread", () => {
    expect(
      nextRaceAutopilotStep(
        input({ entrants: [finished(1), { slot: 2, phase: "working", loaded: true, files: 1 }] }),
      ).kind,
    ).toBe("wait");
    expect(
      nextRaceAutopilotStep(input({ entrants: [finished(1), { ...finished(2), loaded: false }] }))
        .kind,
    ).toBe("wait");
    // An entrant waiting on an approval is not stopped: a person has to answer it.
    expect(
      nextRaceAutopilotStep(
        input({ entrants: [finished(1), { slot: 2, phase: "attention", loaded: true, files: 0 }] }),
      ).kind,
    ).toBe("wait");
  });

  it("starts the judge once everyone stopped, even when one entrant failed", () => {
    expect(
      nextRaceAutopilotStep(
        input({ entrants: [finished(1), { slot: 2, phase: "failed", loaded: true, files: 0 }] }),
      ),
    ).toEqual({ kind: "start-judge", note: "Claude Sonnet 5.5 is judging." });
  });

  it("adopts a judge someone already asked instead of starting another", () => {
    expect(
      nextRaceAutopilotStep(input({ judge: { phase: "judging", verdict: null, error: null } }))
        .kind,
    ).toBe("adopt-judge");
  });

  it("stops with a reason when there is nothing to judge or no judge to ask", () => {
    expect(
      nextRaceAutopilotStep(
        input({
          entrants: [
            { slot: 1, phase: "failed", loaded: true, files: 0 },
            { slot: 2, phase: "failed", loaded: true, files: 0 },
          ],
        }),
      ),
    ).toMatchObject({ kind: "end", to: "stopped", note: expect.stringContaining("failed") });
    expect(
      nextRaceAutopilotStep(input({ entrants: [finished(1, 0), finished(2, 0)] })),
    ).toMatchObject({ kind: "end", to: "stopped", note: expect.stringContaining("No entrant") });
    expect(nextRaceAutopilotStep(input({ judgeReady: false }))).toMatchObject({
      kind: "end",
      to: "stopped",
      note: expect.stringContaining("not ready"),
    });
  });

  it("keeps the judge's pick, or hands it back when keeping is off", () => {
    const judged = input({
      stage: "judging",
      judge: { phase: "done", verdict: { kind: "winner", slot: 2 }, error: null },
    });
    expect(nextRaceAutopilotStep(judged)).toEqual({ kind: "keep", slot: 2 });
    expect(nextRaceAutopilotStep({ ...judged, keep: false })).toMatchObject({
      kind: "end",
      to: "done",
      note: expect.stringContaining("Keep it from the arena"),
    });
  });

  it("never keeps a pick with nothing in it, and reports judges that fail or ramble", () => {
    expect(
      nextRaceAutopilotStep(
        input({
          stage: "judging",
          entrants: [finished(1), finished(2, 0)],
          judge: { phase: "done", verdict: { kind: "winner", slot: 2 }, error: null },
        }),
      ),
    ).toMatchObject({ kind: "end", to: "stopped" });
    expect(
      nextRaceAutopilotStep(
        input({ stage: "judging", judge: { phase: "failed", verdict: null, error: "limit hit" } }),
      ),
    ).toMatchObject({ kind: "end", to: "stopped", note: expect.stringContaining("limit hit") });
    expect(
      nextRaceAutopilotStep(
        input({ stage: "judging", judge: { phase: "done", verdict: null, error: null } }),
      ),
    ).toMatchObject({ kind: "end", to: "stopped", note: expect.stringContaining("Winner line") });
    expect(
      nextRaceAutopilotStep(
        input({
          stage: "judging",
          judge: { phase: "done", verdict: { kind: "none" }, error: null },
        }),
      ),
    ).toMatchObject({ kind: "end", to: "done" });
  });

  it("stands down when the heat was decided by hand", () => {
    expect(nextRaceAutopilotStep(input({ stage: "judging", decided: true }))).toMatchObject({
      kind: "end",
      from: "judging",
      to: "done",
    });
    // Its own Keep is recorded before it marks itself done; that is not "by hand".
    expect(nextRaceAutopilotStep(input({ stage: "keeping", decided: true })).kind).toBe("wait");
  });
});
