/* agent-watermark: model=opus-5.5; effort=high; duration=12m; seat=claude-code; date=2026-10-19 */
import {
  ProjectId,
  type RaceHistoryEntrant,
  type RaceHistoryRecordInput,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  advanceRaceAutopilot,
  isRaceAutopilotActive,
  setRaceAutopilot,
  buildRaceKindLeaders,
  buildRaceLadder,
  buildRaceLeaderboard,
  buildRacePromptRuns,
  guessRaceTaskKind,
  median,
  mergeRaceHistoryRecord,
  RACE_HISTORY_MAX_RECORDS,
  RACE_LADDER_START_RATING,
  raceHeats,
  racePromptKey,
  recommendRaceEntrants,
  upsertRaceHistory,
} from "./raceHistory.ts";

const entrant = (
  slot: number,
  overrides: Partial<RaceHistoryEntrant> = {},
): RaceHistoryEntrant => ({
  slot,
  instanceId: slot === 1 ? "codex" : "claudeAgent",
  driver: slot === 1 ? "codex" : "claudeAgent",
  model: slot === 1 ? "gpt-6.1-sol" : "claude-haiku-5-5",
  label: slot === 1 ? "Codex GPT-6.1-Sol" : "Claude Haiku 5.5",
  phase: "finished",
  elapsedMs: 30_000 * slot,
  files: 2,
  additions: 10,
  deletions: 1,
  costUsd: slot === 1 ? null : 0.04,
  failure: null,
  ...overrides,
});

const input = (overrides: Partial<RaceHistoryRecordInput> = {}): RaceHistoryRecordInput => ({
  raceId: "k3f9a2",
  projectId: ProjectId.make("project-1"),
  projectTitle: "tally",
  titleSeed: "Add a --json flag",
  prompt: "Add a --json flag to the CLI",
  taskKind: "feature",
  taskKindSource: "guessed",
  startedAt: "2026-10-19T08:00:00.000Z",
  outcome: "open",
  keptSlot: null,
  judge: null,
  entrants: [entrant(1), entrant(2)],
  ...overrides,
});

const judge = (pickSlot: number | null) => ({
  instanceId: "claudeAgent",
  driver: "claudeAgent",
  model: "claude-sonnet-5",
  label: "Claude Sonnet 5",
  pickSlot,
});

describe("mergeRaceHistoryRecord", () => {
  it("keeps a Keep when a judge's verdict arrives afterwards", () => {
    const kept = mergeRaceHistoryRecord(null, input({ outcome: "kept", keptSlot: 2 }), "t1");
    const judged = mergeRaceHistoryRecord(kept, input({ judge: judge(1) }), "t2");
    expect(judged).toMatchObject({ outcome: "kept", keptSlot: 2, recordedAt: "t2" });
    expect(judged.judge?.pickSlot).toBe(1);
  });

  it("freezes the entrant lines a race was decided on", () => {
    const kept = mergeRaceHistoryRecord(null, input({ outcome: "kept", keptSlot: 2 }), "t1");
    const afterMerge = mergeRaceHistoryRecord(
      kept,
      input({
        outcome: "kept",
        keptSlot: 2,
        taskKind: "fix",
        taskKindSource: "user",
        entrants: [entrant(2, { additions: 0, deletions: 0, files: 0 })],
      }),
      "t2",
    );
    expect(afterMerge.entrants).toEqual(kept.entrants);
    expect(afterMerge.taskKind).toBe("fix");
  });

  it("keeps an earlier judge when the Keep report has none", () => {
    const judged = mergeRaceHistoryRecord(null, input({ judge: judge(2) }), "t1");
    const kept = mergeRaceHistoryRecord(judged, input({ outcome: "kept", keptSlot: 2 }), "t2");
    expect(kept.judge?.pickSlot).toBe(2);
    expect(kept.outcome).toBe("kept");
  });

  it("never overwrites a kind the user picked with a guess", () => {
    const picked = mergeRaceHistoryRecord(
      null,
      input({ taskKind: "fix", taskKindSource: "user" }),
      "t1",
    );
    expect(mergeRaceHistoryRecord(picked, input(), "t2").taskKind).toBe("fix");
    expect(
      mergeRaceHistoryRecord(picked, input({ taskKind: "docs", taskKindSource: "user" }), "t3")
        .taskKind,
    ).toBe("docs");
  });

  it("keeps a discarded entrant's line and its reported cost", () => {
    const first = mergeRaceHistoryRecord(null, input(), "t1");
    const afterKeep = mergeRaceHistoryRecord(
      first,
      input({ outcome: "kept", keptSlot: 2, entrants: [entrant(2, { costUsd: null })] }),
      "t2",
    );
    expect(afterKeep.entrants.map((item) => item.slot)).toEqual([1, 2]);
    expect(afterKeep.entrants[1]!.costUsd).toBe(0.04);
  });

  it("clips a very long prompt", () => {
    const record = mergeRaceHistoryRecord(null, input({ prompt: "x".repeat(5_000) }), "t1");
    expect(record.prompt.length).toBeLessThanOrEqual(2_001);
  });
});

describe("upsertRaceHistory", () => {
  it("holds one record per race, newest race first, capped", () => {
    let records = upsertRaceHistory([], input({ raceId: "aaaaaa" }), "t1").records;
    records = upsertRaceHistory(
      records,
      input({ raceId: "bbbbbb", startedAt: "2026-10-19T09:00:00.000Z" }),
      "t2",
    ).records;
    records = upsertRaceHistory(
      records,
      input({ raceId: "aaaaaa", outcome: "none" }),
      "t3",
    ).records;
    expect(records.map((record) => [record.raceId, record.outcome])).toEqual([
      ["bbbbbb", "open"],
      ["aaaaaa", "none"],
    ]);
    const many = Array.from({ length: RACE_HISTORY_MAX_RECORDS + 5 }, (_, index) =>
      mergeRaceHistoryRecord(null, input({ raceId: `r${String(index).padStart(5, "0")}` }), "t"),
    );
    expect(upsertRaceHistory(many, input({ raceId: "zzzzzz" }), "t").records).toHaveLength(
      RACE_HISTORY_MAX_RECORDS,
    );
  });
});

describe("guessRaceTaskKind", () => {
  it("reads the kind from the opening sentence first", () => {
    expect(
      guessRaceTaskKind(
        "Add a --json flag to the CLI. Add tests in test/cli.test.js and document it in README.md.",
      ),
    ).toBe("feature");
    expect(
      guessRaceTaskKind(
        "Make tally() ignore case and punctuation, so 'The the, THE!' counts the word the 3 times. Add tests.",
      ),
    ).toBe("feature");
    expect(guessRaceTaskKind("Fix the crash when the input is empty.")).toBe("fix");
    expect(guessRaceTaskKind("Write more tests for top().")).toBe("tests");
    expect(guessRaceTaskKind("Refactor tally into smaller functions.")).toBe("refactor");
    expect(guessRaceTaskKind("Update the README with usage.")).toBe("docs");
    expect(guessRaceTaskKind("hmm")).toBe("other");
  });
});

describe("buildRaceLeaderboard", () => {
  const records = [
    mergeRaceHistoryRecord(null, input({ raceId: "r1", outcome: "kept", keptSlot: 2 }), "t"),
    mergeRaceHistoryRecord(
      null,
      input({
        raceId: "r2",
        taskKind: "fix",
        outcome: "kept",
        keptSlot: 1,
        entrants: [
          entrant(1, { elapsedMs: 90_000 }),
          entrant(2, { phase: "failed", elapsedMs: 3_000 }),
        ],
      }),
      "t",
    ),
    mergeRaceHistoryRecord(null, input({ raceId: "r3", outcome: "none" }), "t"),
    mergeRaceHistoryRecord(null, input({ raceId: "r4", outcome: "open" }), "t"),
  ];

  it("counts wins, keep rate over decided races, failures, median time and reported cost", () => {
    const board = buildRaceLeaderboard(records);
    const codex = board.find((row) => row.driver === "codex")!;
    const claude = board.find((row) => row.driver === "claudeAgent")!;
    expect([codex.races, codex.decided, codex.wins, codex.keepRate]).toEqual([4, 3, 1, 1 / 3]);
    expect(codex.medianMs).toBe(30_000);
    expect([codex.medianCostUsd, codex.costReports]).toEqual([null, 0]);
    expect([claude.wins, claude.failures, claude.costReports, claude.medianCostUsd]).toEqual([
      1, 1, 4, 0.04,
    ]);
    // A failed run's time is not a finishing time.
    expect(claude.medianMs).toBe(60_000);
  });

  it("filters by kind of task and names the leader for each kind", () => {
    expect(buildRaceLeaderboard(records, { taskKind: "fix" })[0]).toMatchObject({
      driver: "codex",
      wins: 1,
    });
    expect(
      buildRaceKindLeaders(records).map((item) => [
        item.taskKind,
        item.decided,
        item.leader?.driver,
      ]),
    ).toEqual([
      ["feature", 2, "claudeAgent"],
      ["fix", 1, "codex"],
    ]);
  });

  it("returns no rows for no history", () => {
    expect(buildRaceLeaderboard([])).toEqual([]);
    expect(median([])).toBeNull();
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });
});

const sonnet = (slot: number, overrides: Partial<RaceHistoryEntrant> = {}) =>
  entrant(slot, {
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    model: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    ...overrides,
  });

describe("rematch heats", () => {
  it("appends a rematch's entrants and decides only its heat", () => {
    const kept = mergeRaceHistoryRecord(null, input({ outcome: "kept", keptSlot: 2 }), "t1");
    const rematch = mergeRaceHistoryRecord(
      kept,
      input({
        heat: 2,
        heatStartedAt: "2026-10-19T09:00:00.000Z",
        participants: [2, 3],
        outcome: "kept",
        keptSlot: 3,
        entrants: [entrant(2, { additions: 0 }), sonnet(3)],
      }),
      "t2",
    );
    expect([rematch.outcome, rematch.keptSlot]).toEqual(["kept", 2]);
    expect(rematch.participants).toEqual([1, 2]);
    expect(rematch.entrants.map((item) => item.slot)).toEqual([1, 2, 3]);
    // The champion's heat-1 line is frozen; the challenger's is new.
    expect(rematch.entrants[1]!.additions).toBe(10);
    expect(raceHeats(rematch).map((heat) => [heat.heat, heat.participants, heat.keptSlot])).toEqual(
      [
        [1, [1, 2], 2],
        [2, [2, 3], 3],
      ],
    );
  });

  it("keeps a rematch heat's decision when its judge reports later", () => {
    let record = mergeRaceHistoryRecord(null, input({ outcome: "kept", keptSlot: 1 }), "t1");
    record = mergeRaceHistoryRecord(
      record,
      input({ heat: 2, participants: [1, 3], outcome: "none", entrants: [sonnet(3)] }),
      "t2",
    );
    record = mergeRaceHistoryRecord(
      record,
      input({ heat: 2, participants: [1, 3], outcome: "open", judge: judge(3), entrants: [] }),
      "t3",
    );
    expect(record.rematches).toEqual([
      expect.objectContaining({ heat: 2, outcome: "none", keptSlot: null, judge: judge(3) }),
    ]);
  });
});

describe("buildRaceLadder", () => {
  it("rates winners above the entrants they beat, champions included, from every heat", () => {
    let record = mergeRaceHistoryRecord(
      null,
      input({ raceId: "r1", outcome: "kept", keptSlot: 2 }),
      "t",
    );
    record = mergeRaceHistoryRecord(
      record,
      input({
        raceId: "r1",
        heat: 2,
        heatStartedAt: "2026-10-19T09:00:00.000Z",
        participants: [2, 3],
        outcome: "kept",
        keptSlot: 3,
        entrants: [sonnet(3)],
      }),
      "t",
    );
    const ladder = buildRaceLadder([record]);
    expect(ladder.map((row) => [row.label, row.wins, row.losses])).toEqual([
      ["Claude Sonnet 5", 1, 0],
      ["Claude Haiku 5.5", 1, 1],
      ["Codex GPT-6.1-Sol", 0, 1],
    ]);
    const byLabel = new Map(ladder.map((row) => [row.label, row]));
    expect(byLabel.get("Claude Sonnet 5")!.rating).toBeGreaterThan(RACE_LADDER_START_RATING);
    expect(byLabel.get("Codex GPT-6.1-Sol")!.rating).toBeLessThan(RACE_LADDER_START_RATING);
    expect(byLabel.get("Claude Sonnet 5")!.provisional).toBe(true);
    expect(byLabel.get("Claude Haiku 5.5")!.spread).toBeLessThan(
      byLabel.get("Claude Sonnet 5")!.spread,
    );
  });

  it("uses the judge's pick for an undecided heat and nothing for a heat with no winner", () => {
    const judged = mergeRaceHistoryRecord(null, input({ raceId: "j", judge: judge(1) }), "t");
    const none = mergeRaceHistoryRecord(null, input({ raceId: "n", outcome: "none" }), "t");
    expect(buildRaceLadder([judged]).find((row) => row.driver === "codex")?.wins).toBe(1);
    expect(buildRaceLadder([none])).toEqual([]);
  });

  it("recommends the best-rated runnable agents for the kind, falling back to overall", () => {
    const records = [
      mergeRaceHistoryRecord(null, input({ raceId: "a", outcome: "kept", keptSlot: 2 }), "t"),
      mergeRaceHistoryRecord(null, input({ raceId: "b", outcome: "kept", keptSlot: 2 }), "t"),
    ];
    const both = [
      { driver: "codex", model: "gpt-6.1-sol" },
      { driver: "claudeAgent", model: "claude-haiku-5-5" },
    ];
    expect(
      recommendRaceEntrants(records, "feature", both).map((r) => [r.row.label, r.scope]),
    ).toEqual([
      ["Claude Haiku 5.5", "kind"],
      ["Codex GPT-6.1-Sol", "kind"],
    ]);
    expect(recommendRaceEntrants(records, "fix", both)[0]!.scope).toBe("overall");
    expect(recommendRaceEntrants(records, "feature", [both[0]!]).map((r) => r.row.label)).toEqual([
      "Codex GPT-6.1-Sol",
    ]);
    expect(recommendRaceEntrants([], "feature", both)).toEqual([]);
  });
});

describe("prompt history", () => {
  it("groups runs of the same prompt regardless of case and spacing, newest heat first", () => {
    expect(racePromptKey("Add a  --json flag\n")).toBe(racePromptKey("add a --json FLAG"));
    expect(racePromptKey("Add a --json flag")).not.toBe(racePromptKey("Add a --yaml flag"));
    let first = mergeRaceHistoryRecord(
      null,
      input({ raceId: "p1", outcome: "kept", keptSlot: 1 }),
      "t",
    );
    first = mergeRaceHistoryRecord(
      first,
      input({
        raceId: "p1",
        heat: 2,
        heatStartedAt: "2026-10-19T10:00:00.000Z",
        participants: [1, 3],
        outcome: "kept",
        keptSlot: 3,
        entrants: [sonnet(3)],
      }),
      "t",
    );
    const other = mergeRaceHistoryRecord(
      null,
      input({
        raceId: "p2",
        prompt: "ADD a --json flag to the CLI",
        startedAt: "2026-10-19T09:00:00.000Z",
      }),
      "t",
    );
    const unrelated = mergeRaceHistoryRecord(null, input({ raceId: "p3", prompt: "Fix it" }), "t");
    const runs = buildRacePromptRuns([first, other, unrelated], racePromptKey(input().prompt));
    expect(runs.map((run) => [run.record.raceId, run.heat.heat, run.winnerSlot])).toEqual([
      ["p1", 2, 3],
      ["p2", 1, null],
      ["p1", 1, 1],
    ]);
    expect(runs[0]!.entrants.map((item) => item.slot)).toEqual([1, 3]);
  });
});

describe("race autopilot", () => {
  const plan = {
    raceId: "k3f9a2",
    heat: 1,
    judge: { instanceId: "claudeAgent", model: "claude-sonnet-5-5" },
    keep: true,
  };

  it("moves only from the stage the caller saw", () => {
    const { autopilots } = setRaceAutopilot([], plan, "2026-10-22T10:00:00.000Z");
    const first = advanceRaceAutopilot(
      autopilots,
      { raceId: "k3f9a2", from: "waiting", to: "judging" },
      "2026-10-22T10:05:00.000Z",
    );
    expect(first.applied).toBe(true);
    expect(first.autopilot?.stage).toBe("judging");
    const late = advanceRaceAutopilot(
      first.autopilots,
      { raceId: "k3f9a2", from: "waiting", to: "judging" },
      "2026-10-22T10:05:01.000Z",
    );
    expect(late.applied).toBe(false);
    expect(late.autopilot?.updatedAt).toBe("2026-10-22T10:05:00.000Z");
    expect(
      advanceRaceAutopilot([], { raceId: "nope", from: "waiting", to: "stopped" }, "x").applied,
    ).toBe(false);
  });

  it("re-arms a race for a rematch heat and keeps the note until a step replaces it", () => {
    const armed = setRaceAutopilot([], plan, "2026-10-22T10:00:00.000Z").autopilots;
    const done = advanceRaceAutopilot(
      armed,
      { raceId: "k3f9a2", from: "waiting", to: "done", note: "Kept Entrant 1." },
      "t",
    ).autopilots;
    const rearmed = setRaceAutopilot(done, { ...plan, heat: 2 }, "t2");
    expect(rearmed.autopilots).toHaveLength(1);
    expect(rearmed.autopilot).toMatchObject({ heat: 2, stage: "waiting", note: null });
    expect(isRaceAutopilotActive("waiting")).toBe(true);
    expect(isRaceAutopilotActive("done")).toBe(false);
  });
});
