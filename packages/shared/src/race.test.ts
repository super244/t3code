/* agent-watermark: model=opus-5.5; effort=high; duration=72m; seat=claude-code; date=2026-10-04 */
import { describe, expect, it } from "vite-plus/test";

import { isTemporaryWorktreeBranch } from "./git.ts";
import { buildRaceBranchName, createRaceId, parseRaceBranchName } from "./race.ts";

describe("race branch identity", () => {
  it("round-trips through the branch name", () => {
    const branch = buildRaceBranchName({ raceId: "k3f9a2", slot: 2, count: 3 });
    expect(branch).toBe("t3code/race-k3f9a2-2of3");
    expect(parseRaceBranchName(branch)).toEqual({ raceId: "k3f9a2", slot: 2, count: 3 });
  });

  it("rejects identities outside the 2-4 entrant range", () => {
    expect(() => buildRaceBranchName({ raceId: "k3f9a2", slot: 1, count: 1 })).toThrow();
    expect(() => buildRaceBranchName({ raceId: "k3f9a2", slot: 5, count: 5 })).toThrow();
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
      "t3code/race-k3f9a2-1of5",
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
