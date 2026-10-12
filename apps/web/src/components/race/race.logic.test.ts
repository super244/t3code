/* agent-watermark: model=opus-5.5; effort=high; duration=110m; seat=claude-code; date=2026-10-04 */
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { buildRaceBranchName } from "@t3tools/shared/race";
import { describe, expect, it } from "vite-plus/test";

import {
  buildRaceEntrantTitle,
  canKeepRaceEntrant,
  defaultRaceEntrants,
  describeRaceKeepResult,
  groupRaces,
  nextRaceEntrant,
  raceEntrantPhase,
  raceKeepConfirmation,
  raceProjectLabels,
  raceTitleSeed,
  validateRaceDraft,
  type RaceThreadInput,
} from "./race.logic";

const environmentId = EnvironmentId.make("env-1");
const projectId = ProjectId.make("project-1");

const thread = (
  id: string,
  overrides: Partial<RaceThreadInput> & { readonly race?: [string, number, number] } = {},
): RaceThreadInput => {
  const { race, ...rest } = overrides;
  return {
    id,
    environmentId,
    projectId,
    title: buildRaceEntrantTitle("Fix the login bug", `Entrant ${id}`),
    branch: race ? buildRaceBranchName({ raceId: race[0], slot: race[1], count: race[2] }) : null,
    worktreePath: `/worktrees/${id}`,
    archivedAt: null,
    createdAt: "2026-10-04T10:00:00.000Z",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt" },
    session: { status: "ready" },
    latestTurn: { state: "completed", completedAt: "2026-10-04T10:05:00.000Z" },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    ...rest,
  };
};

const provider = (id: string, overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(id),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-04T00:00:00.000Z",
  slashCommands: [],
  skills: [],
  models: [
    { slug: "fast", name: "Fast", isCustom: false, capabilities: null },
    { slug: "capable", name: "Capable", isCustom: false, capabilities: null, isDefault: true },
  ],
  ...overrides,
});

describe("groupRaces", () => {
  it("groups entrants by race id in slot order and ignores ordinary threads", () => {
    const races = groupRaces([
      thread("b", { race: ["aaaaaa", 2, 2] }),
      thread("plain"),
      thread("a", { race: ["aaaaaa", 1, 2] }),
      thread("other", { branch: "t3code/1a2b3c4d" }),
    ]);
    expect(races).toHaveLength(1);
    expect(races[0]!.entrants.map((entrant) => entrant.thread.id)).toEqual(["a", "b"]);
    expect(races[0]!.titleSeed).toBe("Fix the login bug");
    expect(races[0]!.count).toBe(2);
  });

  it("keeps races on different computers apart even with the same id", () => {
    const races = groupRaces([
      thread("a", { race: ["aaaaaa", 1, 2] }),
      thread("b", { race: ["aaaaaa", 1, 2], environmentId: EnvironmentId.make("env-2") }),
    ]);
    expect(races).toHaveLength(2);
  });

  it("orders races newest first", () => {
    const races = groupRaces([
      thread("old", { race: ["oooooo", 1, 2], createdAt: "2026-10-01T00:00:00.000Z" }),
      thread("new", { race: ["nnnnnn", 1, 2], createdAt: "2026-10-03T00:00:00.000Z" }),
    ]);
    expect(races.map((race) => race.raceId)).toEqual(["nnnnnn", "oooooo"]);
  });

  it("keeps the started count when entrants are missing, without deciding anything", () => {
    const [race] = groupRaces([
      thread("a", { race: ["aaaaaa", 1, 3] }),
      thread("c", { race: ["aaaaaa", 3, 3] }),
      thread("b", { race: ["aaaaaa", 2, 3], archivedAt: "2026-10-04T11:00:00.000Z" }),
    ]);
    expect(race!.count).toBe(3);
    expect(race!.entrants.map((entrant) => entrant.slot)).toEqual([1, 3]);
    expect(race).not.toHaveProperty("decided");
  });
});

describe("raceTitleSeed", () => {
  it("strips only the entrant suffix", () => {
    expect(raceTitleSeed(buildRaceEntrantTitle("Tidy a · b", "Claude Opus"))).toBe("Tidy a · b");
    expect(raceTitleSeed("Renamed by the agent")).toBe("Renamed by the agent");
  });
});

describe("entrant phase and keep eligibility", () => {
  const entrant = (overrides: Partial<RaceThreadInput> = {}) =>
    thread("e", { race: ["aaaaaa", 1, 2], ...overrides });

  it("only lets a settled entrant with a worktree be kept", () => {
    expect(canKeepRaceEntrant(entrant())).toBe(true);
    expect(canKeepRaceEntrant(entrant({ session: { status: "running" } }))).toBe(false);
    expect(canKeepRaceEntrant(entrant({ hasPendingApprovals: true }))).toBe(false);
    expect(raceEntrantPhase(entrant({ worktreePath: null, latestTurn: null }))).toBe("preparing");
    expect(canKeepRaceEntrant(entrant({ worktreePath: null, latestTurn: null }))).toBe(false);
    expect(raceEntrantPhase(entrant({ session: { status: "error" } }))).toBe("failed");
    expect(canKeepRaceEntrant(entrant({ session: { status: "error" } }))).toBe(true);
  });
});

describe("entrant drafts", () => {
  it("starts with two different providers when available", () => {
    expect(defaultRaceEntrants([provider("codex"), provider("claude")], null)).toEqual([
      { instanceId: "codex", model: "capable" },
      { instanceId: "claude", model: "capable" },
    ]);
  });

  it("falls back to two models of one provider", () => {
    expect(
      defaultRaceEntrants([provider("codex")], {
        instanceId: ProviderInstanceId.make("codex"),
        model: "fast",
      }),
    ).toEqual([
      { instanceId: "codex", model: "fast" },
      { instanceId: "codex", model: "capable" },
    ]);
  });

  it("adds unused providers first and stops at four", () => {
    const providers = [provider("codex"), provider("claude")];
    const entrants = [{ instanceId: "codex", model: "fast" }];
    expect(nextRaceEntrant(providers, entrants)).toEqual({
      instanceId: "claude",
      model: "capable",
    });
    expect(nextRaceEntrant(providers, [...entrants, ...entrants, ...entrants, ...entrants])).toBe(
      null,
    );
  });
});

describe("validateRaceDraft", () => {
  const valid = {
    hasProject: true,
    connected: true,
    isRepo: true,
    baseBranch: "main",
    prompt: "Fix it",
    entrants: [
      { instanceId: "codex", model: "fast" },
      { instanceId: "codex", model: "capable" },
    ],
    providers: [provider("codex")],
  };

  it("accepts a complete draft, including repeated providers", () => {
    expect(validateRaceDraft(valid)).toEqual({ ok: true });
  });

  it("explains the first missing piece", () => {
    expect(validateRaceDraft({ ...valid, isRepo: false })).toMatchObject({ ok: false });
    expect(validateRaceDraft({ ...valid, prompt: "  " })).toEqual({
      ok: false,
      reason: "Describe the task.",
    });
    expect(validateRaceDraft({ ...valid, entrants: valid.entrants.slice(0, 1) })).toEqual({
      ok: false,
      reason: "A race needs 2 to 4 entrants.",
    });
    expect(
      validateRaceDraft({
        ...valid,
        entrants: [valid.entrants[0]!, { instanceId: "codex", model: "retired" }],
      }),
    ).toEqual({ ok: false, reason: "Entrant 2: choose a model." });
    expect(
      validateRaceDraft({ ...valid, providers: [provider("codex", { status: "error" })] }),
    ).toEqual({ ok: false, reason: "Entrant 1: choose a ready provider." });
  });
});

describe("describeRaceKeepResult", () => {
  it("only discards the other entrants after a merge", () => {
    const merged = describeRaceKeepResult(
      { status: "merged", commitSha: "abcdef1234", filesChanged: 1 },
      "main",
    );
    expect(merged).toMatchObject({
      tone: "success",
      title: "Merged into main",
      discardOthers: true,
    });
    expect(merged.description).toBe("1 file changed in abcdef1.");

    for (const result of [
      { status: "nothing_to_merge" },
      { status: "base_dirty", files: ["a.ts"] },
      { status: "conflict", files: ["a.ts"] },
      { status: "rejected", reason: "hook failed" },
      { status: "base_moved", expected: "main", current: "feature" },
      { status: "branch_mismatch", current: null },
    ] as const) {
      expect(describeRaceKeepResult(result, "main")).toMatchObject({
        tone: "warning",
        discardOthers: false,
      });
    }
  });

  it("says nothing changed only for refusals made before the merge", () => {
    for (const result of [
      { status: "base_dirty", files: ["a.ts"] },
      { status: "base_moved", expected: "main", current: "feature" },
      { status: "branch_mismatch", current: "other" },
    ] as const) {
      expect(describeRaceKeepResult(result, "main").description).toContain("Nothing was changed.");
    }
    for (const result of [
      { status: "conflict", files: ["a.ts"] },
      { status: "rejected", reason: "hook failed" },
    ] as const) {
      const { description } = describeRaceKeepResult(result, "main");
      expect(description).not.toContain("Nothing was changed");
      expect(description).toContain("now committed on its own branch");
    }
  });

  it("names the blocking files, branches and hook output", () => {
    expect(
      describeRaceKeepResult(
        { status: "conflict", files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"] },
        null,
      ).description,
    ).toMatch(/^a\.ts, b\.ts, c\.ts and 2 more conflict with the project checkout\./);
    expect(
      describeRaceKeepResult({ status: "base_moved", expected: "main", current: null }, null)
        .description,
    ).toBe(
      "It has a detached HEAD, not main. Switch the checkout to main and keep again. Nothing was changed.",
    );
    const rejected = describeRaceKeepResult(
      { status: "rejected", reason: `pre-commit:\n  lint failed ${"x".repeat(300)}` },
      "main",
    );
    expect(rejected.description.startsWith("pre-commit: lint failed")).toBe(true);
    expect(rejected.description).toContain("…");
  });
});

describe("raceKeepConfirmation", () => {
  it("warns before stacking a second merge from the same race", () => {
    const first = raceKeepConfirmation({
      entrantLabel: "Codex GPT",
      target: "main",
      otherCount: 2,
      previouslyKeptLabel: null,
    });
    expect(first).not.toContain("already merged");
    expect(first).toContain("The other 2 entrants are then deleted with their worktrees.");

    const second = raceKeepConfirmation({
      entrantLabel: "Claude Opus",
      target: "main",
      otherCount: 1,
      previouslyKeptLabel: "Codex GPT",
    });
    expect(second).toContain(
      "Codex GPT from this race was already merged. Keeping this one adds a second squash commit on top.",
    );
  });
});

describe("raceProjectLabels", () => {
  const option = (key: string, title: string, workspaceRoot: string, environmentLabel = "Mac") => ({
    key,
    title,
    workspaceRoot,
    environmentLabel,
  });

  it("leaves unique titles alone and adds a path tail to duplicates", () => {
    const labels = raceProjectLabels([
      option("a", "race-demo", "/Users/l/code/t3code/.t3/race-demo"),
      option("b", "race-demo", "/Users/l/scratch/race-demo"),
      option("c", "app", "/Users/l/app"),
      option("d", "race-demo", "/Users/l/other/race-demo", "Linux box"),
    ]);
    expect(labels.get("a")).toBe("race-demo — …/t3code/.t3/race-demo");
    expect(labels.get("b")).toBe("race-demo — …/l/scratch/race-demo");
    expect(labels.get("c")).toBe("app · Mac");
    expect(labels.get("d")).toBe("race-demo · Linux box");
  });

  it("lengthens the tail until twins differ", () => {
    const labels = raceProjectLabels([
      option("a", "web", "/one/x/apps/web/src/web"),
      option("b", "web", "/two/x/apps/web/src/web"),
    ]);
    expect(labels.get("a")).not.toBe(labels.get("b"));
    expect(labels.get("a")).toBe("web — /one/x/apps/web/src/web");
  });
});
