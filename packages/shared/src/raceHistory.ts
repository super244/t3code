/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=45m; seat=codex; date=2026-10-21 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=40m; seat=codex; date=2026-10-20 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=9m; seat=codex; date=2026-10-19 */
/* agent-watermark: model=opus-5.5; effort=high; duration=30m; seat=claude-code; date=2026-10-19 */
import type {
  RaceHistoryEntrant,
  RaceHistoryListInput,
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
    entrants: decided
      ? existing.entrants.map((entrant) => {
          const source = incoming.entrants.find(
            (next) =>
              next.slot === entrant.slot &&
              next.instanceId === entrant.instanceId &&
              next.model === entrant.model,
          );
          return !entrant.threadId && source?.threadId
            ? { ...entrant, threadId: source.threadId }
            : entrant;
        })
      : mergeEntrants(existing.entrants, incoming.entrants),
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
    const threadId =
      entrant.threadId ??
      (previous?.instanceId === entrant.instanceId && previous.model === entrant.model
        ? previous.threadId
        : undefined);
    bySlot.set(entrant.slot, {
      ...entrant,
      ...(threadId ? { threadId } : {}),
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

/** The same literal search and bounds power the RPC and client-side cross-computer view. */
export function queryRaceHistory<T extends RaceHistoryRecord>(
  records: ReadonlyArray<T>,
  input: RaceHistoryListInput = {},
): {
  readonly records: T[];
  readonly total: number;
  readonly offset: number;
  readonly retentionLimit: number;
} {
  const terms = (input.query ?? "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const after = input.after ? Date.parse(input.after) : null;
  const before = input.before ? Date.parse(input.before) : null;
  const matches = records
    .filter((record) => {
      if (input.projectId && record.projectId !== input.projectId) return false;
      if (input.taskKind && record.taskKind !== input.taskKind) return false;
      if (input.outcome && record.outcome !== input.outcome) return false;
      const instant = Date.parse(record.startedAt);
      if (after !== null && instant < after) return false;
      if (before !== null && instant >= before) return false;
      if (terms.length === 0) return true;
      const text = [
        record.raceId,
        record.projectTitle,
        record.titleSeed,
        record.prompt,
        ...record.entrants.flatMap((entrant) => [
          entrant.label,
          entrant.driver,
          entrant.model,
          entrant.failure ?? "",
        ]),
        record.judge?.label ?? "",
      ]
        .join("\n")
        .toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .toSorted(
      (left, right) =>
        Date.parse(right.startedAt) - Date.parse(left.startedAt) ||
        left.raceId.localeCompare(right.raceId),
    );
  const offset = Math.min(input.offset ?? 0, Math.max(0, matches.length - 1));
  const limit = Math.min(input.limit ?? RACE_HISTORY_MAX_RECORDS, RACE_HISTORY_MAX_RECORDS);
  return {
    records: matches.slice(offset, offset + limit),
    total: matches.length,
    offset,
    retentionLimit: RACE_HISTORY_MAX_RECORDS,
  };
}

/** One row per entrant; absent prices stay blank and text cannot become spreadsheet formulas. */
export function raceHistoryCsv(
  records: ReadonlyArray<
    RaceHistoryRecord & { readonly environmentId?: string; readonly environmentLabel?: string }
  >,
): string {
  const cell = (value: string | number | null): string => {
    let text = value === null ? "" : String(value);
    if (typeof value === "string" && /^[\s]*[=+@-]|^[\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const header = [
    "Entrant thread ID",
    "Judge thread ID",
    "Computer",
    "Environment ID",
    "Race ID",
    "Started at",
    "Project",
    "Task",
    "Outcome",
    "Slot",
    "Harness",
    "Model",
    "Phase",
    "Kept",
    "Judge picked",
    "Elapsed ms",
    "Reported cost USD",
    "Files",
    "Added",
    "Deleted",
    "Failure",
    "Prompt",
  ];
  const rows = records.flatMap((record) =>
    record.entrants.map((entrant) => [
      entrant.threadId ?? "",
      record.judge?.threadId ?? "",
      record.environmentLabel ?? "",
      record.environmentId ?? "",
      record.raceId,
      record.startedAt,
      record.projectTitle,
      record.taskKind,
      record.outcome,
      entrant.slot,
      entrant.driver,
      entrant.model,
      entrant.phase,
      record.outcome === "kept" && record.keptSlot === entrant.slot ? "yes" : "no",
      record.judge?.pickSlot === entrant.slot ? "yes" : "no",
      entrant.elapsedMs,
      entrant.costUsd,
      entrant.files,
      entrant.additions,
      entrant.deletions,
      entrant.failure,
      record.prompt,
    ]),
  );
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** A portable, human-readable receipt, using only retained source evidence. */
export function raceEvidenceMarkdown(
  records: ReadonlyArray<
    RaceHistoryRecord & { readonly environmentId?: string; readonly environmentLabel?: string }
  >,
  capturedAt: string,
): string {
  const text = (value: string) =>
    value
      .replace(/[\r\n]+/g, " ")
      .replace(/([\\`*_{}[\]()#+.!|>~-])/g, "\\$1")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const fenced = (value: string) => {
    const runs = value.match(/~+/g) ?? [];
    const fence = "~".repeat(runs.reduce((longest, run) => Math.max(longest, run.length + 1), 3));
    return `${fence}text\n${value}\n${fence}`;
  };
  const lines = [
    "# Race evidence",
    "",
    `Captured: ${text(capturedAt)}`,
    "",
    `${records.length} retained race${records.length === 1 ? "" : "s"}. This report contains recorded results, not an independent code review. Unknown prices and durations remain unreported. Retained prompts may be capped at 2,000 characters.`,
    "",
  ];
  const matchups = buildRaceMatchups(records);
  if (matchups.length) {
    lines.push(
      "## Head-to-head",
      "",
      "Only shared races. Deltas are A minus B; negative means A used less. Repeated copies of a harness and model in one race are excluded.",
      "",
      "| A | B | Shared | Kept A / B | No winner | Other kept | Winner unknown | Open | Median time delta (ms) | Time pairs | Median cost delta (USD) | Cost pairs |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const row of matchups)
      lines.push(
        `| ${text(row.left.label)} | ${text(row.right.label)} | ${row.races} | ${row.leftWins} / ${row.rightWins} | ${row.noWinner} | ${row.otherWinner} | ${row.unknownWinner} | ${row.open} | ${row.medianTimeDeltaMs ?? "Unreported"} | ${row.timePairs} | ${row.medianCostDeltaUsd ?? "Unreported"} | ${row.costPairs} |`,
      );
    lines.push("");
  }
  for (const record of records) {
    lines.push(
      `## ${text(record.titleSeed || record.raceId)}`,
      "",
      `- Computer: ${text(record.environmentLabel ?? record.environmentId ?? "Not recorded")}`,
      `- Environment ID: ${text(record.environmentId ?? "Not recorded")}`,
      `- Race ID: ${text(record.raceId)}`,
      `- Project: ${text(record.projectTitle || record.projectId)}`,
      `- Started: ${text(record.startedAt)}`,
      `- Recorded: ${text(record.recordedAt)}`,
      `- Task: ${text(RACE_TASK_KIND_LABELS[record.taskKind])} (${record.taskKindSource === "user" ? "user-selected" : "guessed"})`,
      `- Outcome: ${record.outcome === "kept" ? (record.keptSlot === null ? "Kept winner (slot not recorded)" : `Kept entrant #${record.keptSlot}`) : record.outcome === "none" ? "No winner" : "Undecided"}`,
      "",
      "### Entrants",
      "",
      "| Slot | Agent | Harness / model | Phase | Files | Added / deleted | Time | Reported USD |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const entrant of record.entrants) {
      lines.push(
        `| ${entrant.slot} | ${text(entrant.label)} | ${text(entrant.driver)} / ${text(entrant.model)} | ${entrant.phase} | ${entrant.files} | +${entrant.additions} / -${entrant.deletions} | ${entrant.elapsedMs === null ? "Unreported" : `${entrant.elapsedMs} ms`} | ${entrant.costUsd === null ? "Unreported" : entrant.costUsd} |`,
      );
    }
    lines.push("", "### Conversation provenance", "");
    for (const entrant of record.entrants) {
      lines.push(
        `- Entrant #${entrant.slot}: ${text(entrant.threadId ?? "Thread ID not recorded")}`,
      );
      if (entrant.failure)
        lines.push("", `Failure for entrant #${entrant.slot}:`, "", fenced(entrant.failure), "");
    }
    if (record.judge)
      lines.push(
        "",
        `Judge: ${text(record.judge.label)} · ${record.judge.pickSlot === null ? "would keep none" : `picked entrant #${record.judge.pickSlot}`}`,
        `Judge thread: ${text(record.judge.threadId ?? "Not recorded")}`,
      );
    else lines.push("", "Judge: Not recorded");
    lines.push("", "### Retained prompt", "", fenced(record.prompt), "");
  }
  return `${lines.join("\n")}\n`;
}

export interface RaceMatchup {
  readonly key: string;
  readonly left: { readonly driver: string; readonly model: string; readonly label: string };
  readonly right: { readonly driver: string; readonly model: string; readonly label: string };
  readonly races: number;
  readonly leftWins: number;
  readonly rightWins: number;
  readonly noWinner: number;
  readonly otherWinner: number;
  readonly unknownWinner: number;
  readonly open: number;
  /** Left minus right, only when both entrants finished with a duration. */
  readonly medianTimeDeltaMs: number | null;
  readonly timePairs: number;
  /** Left minus right, only when both costs were reported. */
  readonly medianCostDeltaUsd: number | null;
  readonly costPairs: number;
}

/** Matched races only. Repeated copies of one harness+model in a race are ambiguous and excluded. */
export function buildRaceMatchups(records: ReadonlyArray<RaceHistoryRecord>): RaceMatchup[] {
  const groups = new Map<
    string,
    {
      left: RaceMatchup["left"];
      right: RaceMatchup["right"];
      races: number;
      leftWins: number;
      rightWins: number;
      noWinner: number;
      otherWinner: number;
      unknownWinner: number;
      open: number;
      times: number[];
      costs: number[];
    }
  >();
  for (const record of records) {
    const identities = new Map<string, RaceHistoryEntrant[]>();
    for (const entrant of record.entrants) {
      const key = JSON.stringify([entrant.driver, entrant.model]);
      const previous = identities.get(key) ?? [];
      previous.push(entrant);
      identities.set(key, previous);
    }
    const entrants = [...identities.entries()]
      .filter(([, values]) => values.length === 1)
      .toSorted(([a], [b]) => a.localeCompare(b));
    for (let i = 0; i < entrants.length; i++) {
      for (let j = i + 1; j < entrants.length; j++) {
        const [leftKey, leftValues] = entrants[i]!;
        const [rightKey, rightValues] = entrants[j]!;
        const left = leftValues[0]!,
          right = rightValues[0]!;
        const key = JSON.stringify([leftKey, rightKey]);
        const group = groups.get(key) ?? {
          left: { driver: left.driver, model: left.model, label: left.label },
          right: { driver: right.driver, model: right.model, label: right.label },
          races: 0,
          leftWins: 0,
          rightWins: 0,
          noWinner: 0,
          otherWinner: 0,
          unknownWinner: 0,
          open: 0,
          times: [],
          costs: [],
        };
        group.races++;
        if (record.outcome === "open") group.open++;
        else if (record.outcome === "none") group.noWinner++;
        else if (record.keptSlot === left.slot) group.leftWins++;
        else if (record.keptSlot === right.slot) group.rightWins++;
        else if (record.entrants.some((entrant) => entrant.slot === record.keptSlot))
          group.otherWinner++;
        else group.unknownWinner++;
        if (
          left.phase === "finished" &&
          right.phase === "finished" &&
          left.elapsedMs !== null &&
          right.elapsedMs !== null &&
          Number.isFinite(left.elapsedMs) &&
          Number.isFinite(right.elapsedMs)
        )
          group.times.push(left.elapsedMs - right.elapsedMs);
        if (
          left.costUsd !== null &&
          right.costUsd !== null &&
          Number.isFinite(left.costUsd) &&
          Number.isFinite(right.costUsd)
        )
          group.costs.push(left.costUsd - right.costUsd);
        groups.set(key, group);
      }
    }
  }
  return [...groups.entries()]
    .map(([key, { times, costs, ...group }]) => ({
      key,
      ...group,
      medianTimeDeltaMs: median(times),
      timePairs: times.length,
      medianCostDeltaUsd: median(costs),
      costPairs: costs.length,
    }))
    .toSorted((a, b) => b.races - a.races || a.key.localeCompare(b.key));
}

/** Same unique harness/model participation rule used by the head-to-head table. */
export function raceContainsPair(
  record: RaceHistoryRecord,
  pair: Pick<RaceMatchup, "left" | "right">,
): boolean {
  const matches = (entrant: RaceHistoryEntrant, identity: RaceMatchup["left"]) =>
    entrant.driver === identity.driver && entrant.model === identity.model;
  if (pair.left.driver === pair.right.driver && pair.left.model === pair.right.model) return false;
  return (
    record.entrants.filter((entrant) => matches(entrant, pair.left)).length === 1 &&
    record.entrants.filter((entrant) => matches(entrant, pair.right)).length === 1
  );
}
