/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=45m; seat=codex; date=2026-10-21 */
/* agent-watermark: model=opus-5.5; effort=high; duration=12m; seat=claude-code; date=2026-10-19 */
import {
  ProjectId,
  type RaceHistoryEntrant,
  type RaceHistoryRecordInput,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildRaceKindLeaders,
  buildRaceMatchups,
  raceContainsPair,
  raceEvidenceMarkdown,
  buildRaceLeaderboard,
  guessRaceTaskKind,
  median,
  mergeRaceHistoryRecord,
  RACE_HISTORY_MAX_RECORDS,
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

describe("matched race comparisons", () => {
  it("counts only shared races and keeps unknown costs out of paired deltas", () => {
    const records = [
      input({ outcome: "kept", keptSlot: 1 }),
      input({
        outcome: "kept",
        keptSlot: 2,
        entrants: [entrant(2), entrant(1, { costUsd: 0.02 })],
      }),
      input({ outcome: "none" }),
      input({ entrants: [entrant(1)] }),
      input({ entrants: [entrant(1), entrant(2, { phase: "failed" })] }),
    ].map((value, index) =>
      mergeRaceHistoryRecord(null, { ...value, raceId: `race-${index}` }, "now"),
    );
    const result = buildRaceMatchups(records);
    expect(result).toHaveLength(1);
    const row = result[0]!;
    expect(row).toMatchObject({
      races: 4,
      leftWins: 1,
      rightWins: 1,
      noWinner: 1,
      open: 1,
      otherWinner: 0,
      timePairs: 3,
      costPairs: 1,
    });
    const report = raceEvidenceMarkdown(records, "now");
    expect(report).toContain("## Head-to-head");
    expect(report).toContain("Only shared races");
    expect(report).toContain("| Time pairs | Median cost delta (USD) | Cost pairs |");
    const leftIsClaude = row.left.driver === "claudeAgent";
    expect(row.medianTimeDeltaMs).toBe(leftIsClaude ? 30000 : -30000);
    expect(row.medianCostDeltaUsd).toBeCloseTo(leftIsClaude ? 0.02 : -0.02);
  });

  it("keeps third-party winners separate and excludes ambiguous repeated models", () => {
    const third = entrant(3, { driver: "codex", model: "other", label: "Other" });
    const race = mergeRaceHistoryRecord(
      null,
      input({ outcome: "kept", keptSlot: 3, entrants: [entrant(1), entrant(2), third] }),
      "now",
    );
    const pair = buildRaceMatchups([race]).find(
      (row) =>
        [row.left.model, row.right.model].includes("gpt-6.1-sol") &&
        [row.left.model, row.right.model].includes("claude-haiku-5-5"),
    );
    expect(pair?.otherWinner).toBe(1);
    expect(pair?.noWinner).toBe(0);
    const repeated = mergeRaceHistoryRecord(
      null,
      input({
        entrants: [entrant(1), entrant(2), entrant(3, { driver: "codex", model: "gpt-6.1-sol" })],
      }),
      "now",
    );
    expect(buildRaceMatchups([repeated])).toEqual([]);
  });
});

it("keeps a missing or unrecognised kept slot unknown", () => {
  const records = [null, 99].map((keptSlot, index) =>
    mergeRaceHistoryRecord(
      null,
      input({ raceId: `unknown-${index}`, outcome: "kept", keptSlot }),
      "now",
    ),
  );
  expect(buildRaceMatchups(records)[0]).toMatchObject({
    races: 2,
    unknownWinner: 2,
    otherWinner: 0,
    leftWins: 0,
    rightWins: 0,
  });
});

it("pair drilldown contains the exact supporting races, including third-party winners", () => {
  const shared = mergeRaceHistoryRecord(null, input({ outcome: "kept", keptSlot: 1 }), "now");
  const missing = mergeRaceHistoryRecord(
    null,
    input({ raceId: "one", entrants: [entrant(1)] }),
    "now",
  );
  const ambiguous = mergeRaceHistoryRecord(
    null,
    input({
      raceId: "repeat",
      entrants: [entrant(1), entrant(2), entrant(3, { driver: "codex", model: "gpt-6.1-sol" })],
    }),
    "now",
  );
  const three = mergeRaceHistoryRecord(
    null,
    input({
      raceId: "third",
      outcome: "kept",
      keptSlot: 3,
      entrants: [entrant(1), entrant(2), entrant(3, { driver: "codex", model: "other" })],
    }),
    "now",
  );
  const pair = buildRaceMatchups([shared])[0]!;
  const selected = [shared, missing, ambiguous, three].filter((record) =>
    raceContainsPair(record, pair),
  );
  expect(selected.map((record) => record.raceId)).toEqual([shared.raceId, "third"]);
  expect(buildRaceMatchups(selected).find((row) => row.key === pair.key)?.races).toBe(2);
  expect(raceContainsPair(shared, { left: pair.left, right: pair.left })).toBe(false);
  expect(raceContainsPair(shared, { left: pair.right, right: pair.left })).toBe(true);
});
