/* agent-watermark: model=opus-5.5; effort=high; duration=2m; seat=claude-code; date=2026-10-19 */
/* agent-watermark: model=opus-5.5; effort=high; duration=8m; seat=claude-code; date=2026-10-18 */
/* agent-watermark: model=opus-5.5; effort=high; duration=72m; seat=claude-code; date=2026-10-04 */
import { describe, expect, it } from "vite-plus/test";

import { isTemporaryWorktreeBranch } from "./git.ts";
import {
  buildRaceBranchName,
  buildRaceJudgeBrief,
  buildRaceJudgeTitle,
  createRaceId,
  parseRaceBranchName,
  parseRaceJudgeHeat,
  parseRaceJudgeMarker,
  parseRaceJudgeVerdict,
} from "./race.ts";

describe("race branch identity", () => {
  it("parses rematch entrants that grew the race past four", () => {
    expect(parseRaceBranchName("t3code/race-k3f9a2-5of6")).toEqual({
      raceId: "k3f9a2",
      slot: 5,
      count: 6,
    });
  });

  it("round-trips through the branch name", () => {
    const branch = buildRaceBranchName({ raceId: "k3f9a2", slot: 2, count: 3 });
    expect(branch).toBe("t3code/race-k3f9a2-2of3");
    expect(parseRaceBranchName(branch)).toEqual({ raceId: "k3f9a2", slot: 2, count: 3 });
  });

  it("rejects identities outside the 2-9 slot range", () => {
    expect(() => buildRaceBranchName({ raceId: "k3f9a2", slot: 1, count: 1 })).toThrow();
    expect(() => buildRaceBranchName({ raceId: "k3f9a2", slot: 10, count: 10 })).toThrow();
    // Rematches grow a race past four entrants, up to the single-digit slot.
    expect(buildRaceBranchName({ raceId: "k3f9a2", slot: 6, count: 6 })).toBe(
      "t3code/race-k3f9a2-6of6",
    );
    expect(() => buildRaceBranchName({ raceId: "k3f9a2", slot: 3, count: 2 })).toThrow();
    expect(() => buildRaceBranchName({ raceId: "K3F9A2", slot: 1, count: 2 })).toThrow();
  });

  it("does not parse ordinary or malformed branches", () => {
    for (const branch of [
      null,
      "",
      "main",
      "t3code/1a2b3c4d",
      "t3code/race-k3f9a2-3of2",
      "t3code/race-k3f9a2-6of5",
      "t3code/race-k3f9a-1of2",
      "feature/race-k3f9a2-1of2",
      "t3code/race-k3f9a2-1of2-extra",
    ]) {
      expect(parseRaceBranchName(branch)).toBeNull();
    }
  });

  it("stays distinct from temporary worktree branches, which get renamed", () => {
    expect(
      isTemporaryWorktreeBranch(buildRaceBranchName({ raceId: "abcdef", slot: 1, count: 2 })),
    ).toBe(false);
  });

  it("creates six lowercase base36 characters", () => {
    expect(createRaceId()).toMatch(/^[0-9a-z]{6}$/);
    expect(createRaceId(() => new Uint8Array([0, 1, 35, 36, 71, 255]))).toBe("01z0z3");
  });
});

describe("race judge", () => {
  const entrant = (
    slot: number,
    overrides: Partial<Parameters<typeof buildRaceJudgeBrief>[0]["entrants"][number]> = {},
  ) => ({
    slot,
    label: slot === 1 ? "Claude Haiku 5.5" : "Codex GPT-6.1-Sol",
    branch: buildRaceBranchName({ raceId: "k3f9a2", slot, count: 2 }),
    worktreePath: `/tmp/wt/race-${slot}`,
    phase: "finished",
    files: [{ path: "src/cli.js", additions: 20 + slot, deletions: 0 }],
    diff: `diff --git a/src/cli.js b/src/cli.js\n+entrant ${slot}`,
    finalMessage: `Entrant ${slot} says it is done.`,
    ...overrides,
  });

  it("writes a brief whose marker names the race and which carries every entrant's work", () => {
    const brief = buildRaceJudgeBrief({
      raceId: "k3f9a2",
      prompt: "Add a --json flag",
      entrants: [
        entrant(1),
        entrant(2, { files: [], diff: "", finalMessage: null, phase: "failed" }),
      ],
    });
    expect(parseRaceJudgeMarker(brief)).toBe("k3f9a2");
    expect(brief).toContain("> Add a --json flag");
    expect(brief).toContain("## Entrant 1: Claude Haiku 5.5");
    expect(brief).toContain("`/tmp/wt/race-1`");
    expect(brief).toContain("+entrant 1");
    expect(brief).toContain("## Entrant 2: Codex GPT-6.1-Sol");
    expect(brief).toContain("Status: failed.");
    expect(brief).toContain("It changed no files.");
    expect(brief).toContain("`Winner: Entrant N`");
  });

  it("clips a huge diff instead of overflowing the brief", () => {
    const brief = buildRaceJudgeBrief({
      raceId: "k3f9a2",
      prompt: "x",
      entrants: [entrant(1, { diff: "+".repeat(50_000) }), entrant(2)],
    });
    expect(brief.length).toBeLessThan(20_000);
    expect(brief).toMatch(/\[clipped \d+ chars\]/);
  });

  it("finds judges by title and ignores briefs for other races", () => {
    expect(buildRaceJudgeTitle("Add a --json flag")).toBe("Judge · Add a --json flag");
    expect(buildRaceJudgeTitle("  ")).toBe("Judge · Race");
    expect(parseRaceJudgeMarker("[Judge of race zzzzzz]\n...")).toBe("zzzzzz");
    expect(parseRaceJudgeMarker("Please judge race k3f9a2")).toBeNull();
    expect(parseRaceJudgeMarker(null)).toBeNull();
  });

  it("reads the verdict line in the forms models actually write", () => {
    const slots = [1, 2, 3];
    expect(parseRaceJudgeVerdict("Notes...\nWinner: Entrant 2", slots)).toEqual({
      kind: "winner",
      slot: 2,
    });
    expect(parseRaceJudgeVerdict("**Winner:** Entrant 3", slots)).toEqual({
      kind: "winner",
      slot: 3,
    });
    expect(parseRaceJudgeVerdict("## Winner: entrant #1", slots)).toEqual({
      kind: "winner",
      slot: 1,
    });
    expect(parseRaceJudgeVerdict("Winner: none", slots)).toEqual({ kind: "none" });
    // The last verdict line wins when a judge changes its mind.
    expect(
      parseRaceJudgeVerdict("Winner: Entrant 1\nOn reflection:\nWinner: Entrant 2", slots),
    ).toEqual({
      kind: "winner",
      slot: 2,
    });
  });

  it("gives no verdict until there is a usable line", () => {
    expect(parseRaceJudgeVerdict("Still reading entrant 2's tests…", [1, 2])).toBeNull();
    expect(parseRaceJudgeVerdict("The winner of this round is unclear", [1, 2])).toBeNull();
    expect(parseRaceJudgeVerdict("Winner: Entrant 4", [1, 2])).toBeNull();
    expect(parseRaceJudgeVerdict(undefined, [1, 2])).toBeNull();
  });
});

describe("race judge heats", () => {
  it("names the rematch heat it judges and reads it back", () => {
    const brief = buildRaceJudgeBrief({ raceId: "k3f9a2", heat: 2, prompt: "x", entrants: [] });
    expect(parseRaceJudgeMarker(brief)).toBe("k3f9a2");
    expect(parseRaceJudgeHeat(brief)).toBe(2);
    expect(parseRaceJudgeHeat("[Judge of race k3f9a2]\n")).toBe(1);
    expect(parseRaceJudgeHeat("no marker")).toBeNull();
  });
});
