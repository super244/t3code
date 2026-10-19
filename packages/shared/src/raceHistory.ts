/* agent-watermark: model=opus-5.5; effort=high; duration=30m; seat=claude-code; date=2026-10-19 */
import type {
  RaceHistoryEntrant,
  RaceHistoryRecord,
  RaceHistoryRecordInput,
  RaceTaskKind,
} from "@t3tools/contracts";

/**
 * Pure rules for race history: how a new report folds into an existing
 * record, how a prompt's kind is guessed, and how records become a
 * leaderboard. The server stores records; every client ranks them the same way.
 */

export const RACE_HISTORY_MAX_RECORDS = 500;
const RACE_HISTORY_PROMPT_MAX_CHARS = 2_000;

/**
 * Folds a report into the stored record. A later report fills in what an
 * earlier one lacked but never undoes a decision: a judge's verdict arriving
 * after Keep keeps the Keep and the entrant lines it was decided on, a Keep
 * keeps an earlier judge, and a kind the user picked by hand survives every
 * guess.
 */
export function mergeRaceHistoryRecord(
  existing: RaceHistoryRecord | null,
  incoming: RaceHistoryRecordInput,
  recordedAt: string,
): RaceHistoryRecord {
  const prompt =
    incoming.prompt.length > RACE_HISTORY_PROMPT_MAX_CHARS
      ? `${incoming.prompt.slice(0, RACE_HISTORY_PROMPT_MAX_CHARS)}…`
      : incoming.prompt;
  if (!existing) return { ...incoming, prompt, recordedAt };

  const decided = existing.outcome !== "open";
  const keepDecision = decided && incoming.outcome === "open";
  const keepKind = existing.taskKindSource === "user" && incoming.taskKindSource === "guessed";
  return {
    ...existing,
    projectTitle: incoming.projectTitle || existing.projectTitle,
    titleSeed: incoming.titleSeed || existing.titleSeed,
    prompt: prompt || existing.prompt,
    taskKind: keepKind ? existing.taskKind : incoming.taskKind,
    taskKindSource: keepKind ? existing.taskKindSource : incoming.taskKindSource,
    startedAt: existing.startedAt < incoming.startedAt ? existing.startedAt : incoming.startedAt,
    outcome: keepDecision ? existing.outcome : incoming.outcome,
    keptSlot: keepDecision ? existing.keptSlot : incoming.keptSlot,
    judge: incoming.judge ?? existing.judge,
    // A decided race keeps the entrant lines it was decided on: after Keep the
    // winner's worktree diff reads empty and the losers are gone, so a later
    // report (a judge, a kind change) must not rewrite them.
    entrants: decided ? existing.entrants : mergeEntrants(existing.entrants, incoming.entrants),
    recordedAt,
  };
}

function mergeEntrants(
  existing: ReadonlyArray<RaceHistoryEntrant>,
  incoming: ReadonlyArray<RaceHistoryEntrant>,
): RaceHistoryEntrant[] {
  const bySlot = new Map<number, RaceHistoryEntrant>();
  for (const entrant of existing) bySlot.set(entrant.slot, entrant);
  for (const entrant of incoming) {
    const previous = bySlot.get(entrant.slot);
    bySlot.set(entrant.slot, {
      ...entrant,
      costUsd: entrant.costUsd ?? previous?.costUsd ?? null,
      elapsedMs: entrant.elapsedMs ?? previous?.elapsedMs ?? null,
    });
  }
  return [...bySlot.values()].toSorted((left, right) => left.slot - right.slot);
}

/** Newest first, capped, one record per race. */
export function upsertRaceHistory(
  records: ReadonlyArray<RaceHistoryRecord>,
  incoming: RaceHistoryRecordInput,
  recordedAt: string,
): { readonly records: RaceHistoryRecord[]; readonly record: RaceHistoryRecord } {
  const existing = records.find((record) => record.raceId === incoming.raceId) ?? null;
  const record = mergeRaceHistoryRecord(existing, incoming, recordedAt);
  const rest = records.filter((item) => item.raceId !== incoming.raceId);
  const next = [record, ...rest]
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, RACE_HISTORY_MAX_RECORDS);
  return { records: next, record };
}

const TASK_KIND_RULES: ReadonlyArray<readonly [RaceTaskKind, RegExp]> = [
  ["fix", /\b(fix|bug|broken|crash(es)?|regression|fail(s|ing)?|wrong|incorrect|doesn'?t work)\b/i],
  ["tests", /\b(tests?|coverage|flaky)\b/i],
  ["refactor", /\b(refactor|clean ?up|simplify|extract|rename|restructure|deduplicate)\b/i],
  ["docs", /\b(docs?|documentation|readme|changelog)\b/i],
  ["feature", /\b(add|implement|create|build|support|introduce|new|make|allow|enable)\b/i],
];

function matchTaskKind(text: string): RaceTaskKind | null {
  for (const [kind, pattern] of TASK_KIND_RULES) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

/**
 * A first guess at what kind of task a prompt is, from its wording alone. The
 * opening sentence says what the task is ("Add a flag… Add tests" is a feature
 * that comes with tests), so it decides before the rest of the prompt does.
 * The arena shows the guess and lets the user change it.
 */
export function guessRaceTaskKind(prompt: string): RaceTaskKind {
  const text = prompt.trim().slice(0, 600);
  const opening = text.split(/(?<=[.!?])\s|\n/)[0] ?? "";
  return matchTaskKind(opening) ?? matchTaskKind(text) ?? "other";
}

export const RACE_TASK_KIND_LABELS: Record<RaceTaskKind, string> = {
  feature: "Feature",
  fix: "Bug fix",
  refactor: "Refactor",
  tests: "Tests",
  docs: "Docs",
  other: "Other",
};

export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export interface RaceLeaderboardRow {
  /** `${driver}\0${model}`: one row per harness and model. */
  readonly key: string;
  readonly driver: string;
  readonly model: string;
  readonly label: string;
  /** Races entered. */
  readonly races: number;
  /** Races that ended with a decision (kept or none), the denominator of the keep rate. */
  readonly decided: number;
  readonly wins: number;
  readonly keepRate: number | null;
  readonly judgePicks: number;
  readonly failures: number;
  readonly medianMs: number | null;
  readonly medianCostUsd: number | null;
  /** How many of its races reported a cost; the cost column is about these only. */
  readonly costReports: number;
  readonly lastRaceAt: string;
}

/**
 * Ranks harness+model pairs by what users kept. Wins count only kept races;
 * the keep rate is wins over decided races, so open races never lower it.
 */
export function buildRaceLeaderboard(
  records: ReadonlyArray<RaceHistoryRecord>,
  filter: { readonly taskKind?: RaceTaskKind | null } = {},
): RaceLeaderboardRow[] {
  const rows = new Map<
    string,
    {
      driver: string;
      model: string;
      label: string;
      races: number;
      decided: number;
      wins: number;
      judgePicks: number;
      failures: number;
      times: number[];
      costs: number[];
      lastRaceAt: string;
    }
  >();
  for (const record of records) {
    if (filter.taskKind && record.taskKind !== filter.taskKind) continue;
    for (const entrant of record.entrants) {
      const key = `${entrant.driver}\0${entrant.model}`;
      const row = rows.get(key) ?? {
        driver: entrant.driver,
        model: entrant.model,
        label: entrant.label,
        races: 0,
        decided: 0,
        wins: 0,
        judgePicks: 0,
        failures: 0,
        times: [],
        costs: [],
        lastRaceAt: record.startedAt,
      };
      row.races += 1;
      if (record.outcome !== "open") row.decided += 1;
      if (record.outcome === "kept" && record.keptSlot === entrant.slot) row.wins += 1;
      if (record.judge?.pickSlot === entrant.slot) row.judgePicks += 1;
      if (entrant.phase === "failed") row.failures += 1;
      if (entrant.phase === "finished" && entrant.elapsedMs !== null) {
        row.times.push(entrant.elapsedMs);
      }
      if (entrant.costUsd !== null) row.costs.push(entrant.costUsd);
      if (record.startedAt >= row.lastRaceAt) {
        row.lastRaceAt = record.startedAt;
        row.label = entrant.label;
      }
      rows.set(key, row);
    }
  }
  return [...rows.entries()]
    .map(([key, row]) => ({
      key,
      driver: row.driver,
      model: row.model,
      label: row.label,
      races: row.races,
      decided: row.decided,
      wins: row.wins,
      keepRate: row.decided > 0 ? row.wins / row.decided : null,
      judgePicks: row.judgePicks,
      failures: row.failures,
      medianMs: median(row.times),
      medianCostUsd: median(row.costs),
      costReports: row.costs.length,
      lastRaceAt: row.lastRaceAt,
    }))
    .toSorted(
      (left, right) =>
        right.wins - left.wins ||
        (right.keepRate ?? -1) - (left.keepRate ?? -1) ||
        right.races - left.races ||
        left.label.localeCompare(right.label),
    );
}

export interface RaceKindLeader {
  readonly taskKind: RaceTaskKind;
  readonly decided: number;
  /** Null until some agent in this kind has a win. */
  readonly leader: RaceLeaderboardRow | null;
}

/** Who wins most for each kind of task that has at least one decided race. */
export function buildRaceKindLeaders(records: ReadonlyArray<RaceHistoryRecord>): RaceKindLeader[] {
  const kinds = new Set(
    records.filter((record) => record.outcome !== "open").map((record) => record.taskKind),
  );
  return [...kinds]
    .map((taskKind) => {
      const top = buildRaceLeaderboard(records, { taskKind })[0] ?? null;
      return {
        taskKind,
        decided: records.filter(
          (record) => record.taskKind === taskKind && record.outcome !== "open",
        ).length,
        leader: top && top.wins > 0 ? top : null,
      };
    })
    .toSorted(
      (left, right) => right.decided - left.decided || left.taskKind.localeCompare(right.taskKind),
    );
}
