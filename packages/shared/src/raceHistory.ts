/* agent-watermark: model=opus-5.5; effort=high; duration=75m; seat=claude-code; date=2026-10-19 */
import type {
  RaceAdvanceAutopilotInput,
  RaceAutopilot,
  RaceAutopilotPlan,
  RaceAutopilotStage,
  RaceHistoryEntrant,
  RaceHistoryHeat,
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

/** One ladder entry per harness, model and reasoning effort. */
export function raceAgentKey(entrant: {
  readonly driver: string;
  readonly model: string;
  readonly effort?: string | null | undefined;
}): string {
  return `${entrant.driver}\0${entrant.model}\0${entrant.effort ?? ""}`;
}
const RACE_HISTORY_PROMPT_MAX_CHARS = 2_000;

/** A heat as the ladder and history read it: heat 1 is the original race. */
export interface RaceHeatView {
  readonly heat: number;
  readonly startedAt: string;
  readonly participants: ReadonlyArray<number>;
  readonly outcome: RaceHistoryRecord["outcome"];
  readonly keptSlot: number | null;
  readonly judge: RaceHistoryRecord["judge"];
}

export function raceHeats(record: RaceHistoryRecord): RaceHeatView[] {
  const first: RaceHeatView = {
    heat: 1,
    startedAt: record.startedAt,
    // Records from before rematches have no participant list: every entrant
    // took part. A rematch pins heat 1's list before it appends anyone.
    participants: record.participants ?? record.entrants.map((entrant) => entrant.slot),
    outcome: record.outcome,
    keptSlot: record.keptSlot,
    judge: record.judge,
  };
  return [first, ...(record.rematches ?? [])].toSorted((left, right) => left.heat - right.heat);
}

/** Slots whose lines are fixed because a heat they were in has been decided. */
function frozenSlots(record: RaceHistoryRecord): Set<number> {
  const frozen = new Set<number>();
  for (const heat of raceHeats(record)) {
    if (heat.outcome === "open") continue;
    for (const slot of heat.participants) frozen.add(slot);
  }
  return frozen;
}

function clipPrompt(prompt: string): string {
  return prompt.length > RACE_HISTORY_PROMPT_MAX_CHARS
    ? `${prompt.slice(0, RACE_HISTORY_PROMPT_MAX_CHARS)}…`
    : prompt;
}

/**
 * Folds a report into the stored record. A later report fills in what an
 * earlier one lacked but never undoes a decision: a judge's verdict arriving
 * after Keep keeps the Keep and the entrant lines it was decided on, a Keep
 * keeps an earlier judge, and a kind the user picked by hand survives every
 * guess. A report for heat 2+ (a rematch) decides only that heat, and its new
 * entrants are appended to the race.
 */
export function mergeRaceHistoryRecord(
  existing: RaceHistoryRecord | null,
  incoming: RaceHistoryRecordInput,
  recordedAt: string,
): RaceHistoryRecord {
  const {
    heat: incomingHeat,
    heatStartedAt,
    participants: incomingParticipantsInput,
    baseCommit: incomingBase,
    ...fields
  } = incoming;
  const heat = incomingHeat ?? 1;
  const prompt = clipPrompt(incoming.prompt);
  const incomingParticipants =
    incomingParticipantsInput ?? incoming.entrants.map((entrant) => entrant.slot);
  const heatEntry = (previous: RaceHistoryHeat | null): RaceHistoryHeat => {
    const keep = previous !== null && previous.outcome !== "open" && incoming.outcome === "open";
    return {
      heat,
      startedAt: previous?.startedAt ?? heatStartedAt ?? incoming.startedAt,
      participants:
        previous && previous.outcome !== "open" ? previous.participants : incomingParticipants,
      outcome: keep ? previous.outcome : incoming.outcome,
      keptSlot: keep ? previous.keptSlot : incoming.outcome === "kept" ? incoming.keptSlot : null,
      judge: incoming.judge ?? previous?.judge ?? null,
    };
  };

  if (!existing) {
    const base: RaceHistoryRecord = {
      ...fields,
      prompt,
      recordedAt,
      baseCommit: incomingBase ?? null,
    };
    if (heat === 1) {
      return incoming.outcome === "open" ? base : { ...base, participants: incomingParticipants };
    }
    return {
      ...base,
      outcome: "open",
      keptSlot: null,
      judge: null,
      rematches: [heatEntry(null)],
    };
  }

  const keepKind = existing.taskKindSource === "user" && incoming.taskKindSource === "guessed";
  const frozen = frozenSlots(existing);
  const shared = {
    ...existing,
    projectTitle: incoming.projectTitle || existing.projectTitle,
    titleSeed: incoming.titleSeed || existing.titleSeed,
    prompt: prompt || existing.prompt,
    taskKind: keepKind ? existing.taskKind : incoming.taskKind,
    taskKindSource: keepKind ? existing.taskKindSource : incoming.taskKindSource,
    startedAt: existing.startedAt < incoming.startedAt ? existing.startedAt : incoming.startedAt,
    baseCommit: existing.baseCommit ?? incomingBase ?? null,
    // A decided heat keeps the entrant lines it was decided on: after Keep the
    // winner's worktree diff reads empty and the losers are gone, so a later
    // report (a judge, a kind change, a rematch) must not rewrite them.
    entrants: mergeEntrants(
      existing.entrants,
      incoming.entrants.filter((entrant) => !frozen.has(entrant.slot)),
    ),
    recordedAt,
  };

  if (heat > 1) {
    const rematches = existing.rematches ?? [];
    const previous = rematches.find((item) => item.heat === heat) ?? null;
    return {
      ...shared,
      participants: existing.participants ?? existing.entrants.map((entrant) => entrant.slot),
      rematches: [...rematches.filter((item) => item.heat !== heat), heatEntry(previous)].toSorted(
        (left, right) => left.heat - right.heat,
      ),
    };
  }

  const decided = existing.outcome !== "open";
  const keepDecision = decided && incoming.outcome === "open";
  const participants = decided
    ? existing.participants
    : incoming.outcome !== "open"
      ? incomingParticipants
      : existing.participants;
  return {
    ...shared,
    outcome: keepDecision ? existing.outcome : incoming.outcome,
    keptSlot: keepDecision ? existing.keptSlot : incoming.keptSlot,
    judge: incoming.judge ?? existing.judge,
    ...(participants ? { participants } : {}),
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

export const RACE_AUTOPILOT_MAX = 200;

/** Stages a client still has work to do in. */
export function isRaceAutopilotActive(stage: RaceAutopilotStage): boolean {
  return stage === "waiting" || stage === "judging" || stage === "keeping";
}

/** Arms a race's autopilot, replacing any earlier plan for it (a rematch re-arms). */
export function setRaceAutopilot(
  autopilots: ReadonlyArray<RaceAutopilot>,
  plan: RaceAutopilotPlan,
  now: string,
): { readonly autopilots: RaceAutopilot[]; readonly autopilot: RaceAutopilot } {
  const autopilot: RaceAutopilot = {
    raceId: plan.raceId,
    heat: plan.heat,
    judge: plan.judge,
    keep: plan.keep,
    stage: "waiting",
    note: null,
    createdAt: now,
    updatedAt: now,
  };
  const rest = autopilots.filter((item) => item.raceId !== plan.raceId);
  return { autopilots: [autopilot, ...rest].slice(0, RACE_AUTOPILOT_MAX), autopilot };
}

/**
 * Compare-and-set: moves a race's autopilot from the stage the caller saw to
 * the next one. Every open client may race to take the same step; only the
 * first one's move applies, and it alone acts on it.
 */
export function advanceRaceAutopilot(
  autopilots: ReadonlyArray<RaceAutopilot>,
  input: RaceAdvanceAutopilotInput,
  now: string,
): {
  readonly autopilots: RaceAutopilot[];
  readonly applied: boolean;
  readonly autopilot: RaceAutopilot | null;
} {
  const current = autopilots.find((item) => item.raceId === input.raceId) ?? null;
  if (!current || current.stage !== input.from) {
    return { autopilots: [...autopilots], applied: false, autopilot: current };
  }
  const autopilot: RaceAutopilot = {
    ...current,
    stage: input.to,
    note: input.note === undefined ? current.note : input.note,
    updatedAt: now,
  };
  return {
    autopilots: autopilots.map((item) => (item.raceId === input.raceId ? autopilot : item)),
    applied: true,
    autopilot,
  };
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
  readonly effort: string | null;
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
      effort: string | null;
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
    const bySlot = new Map(record.entrants.map((entrant) => [entrant.slot, entrant] as const));
    const rowFor = (entrant: RaceHistoryEntrant) => {
      const key = raceAgentKey(entrant);
      const row = rows.get(key) ?? {
        driver: entrant.driver,
        model: entrant.model,
        effort: entrant.effort ?? null,
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
      rows.set(key, row);
      return row;
    };
    // Per entrant: its own run's time, cost and failure, counted once.
    for (const entrant of record.entrants) {
      const row = rowFor(entrant);
      if (entrant.phase === "failed") row.failures += 1;
      if (entrant.phase === "finished" && entrant.elapsedMs !== null) {
        row.times.push(entrant.elapsedMs);
      }
      if (entrant.costUsd !== null) row.costs.push(entrant.costUsd);
      if (record.startedAt >= row.lastRaceAt) {
        row.lastRaceAt = record.startedAt;
        row.label = entrant.label;
      }
    }
    // Per heat: a champion that defends its win in a rematch races again.
    for (const heat of raceHeats(record)) {
      for (const slot of heat.participants) {
        const entrant = bySlot.get(slot);
        if (!entrant) continue;
        const row = rowFor(entrant);
        row.races += 1;
        if (heat.outcome !== "open") row.decided += 1;
        if (heat.outcome === "kept" && heat.keptSlot === slot) row.wins += 1;
        if (heat.judge?.pickSlot === slot) row.judgePicks += 1;
      }
    }
  }
  return [...rows.entries()]
    .map(([key, row]) => ({
      key,
      driver: row.driver,
      model: row.model,
      effort: row.effort,
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

// ---------------------------------------------------------------------------
// Ladder: Elo-style ratings from head-to-head results
// ---------------------------------------------------------------------------

export const RACE_LADDER_START_RATING = 1500;
const RACE_LADDER_K = 32;
/** Below this many head-to-heads a rating is provisional. */
export const RACE_LADDER_PROVISIONAL_GAMES = 5;

export interface RaceLadderRow {
  readonly key: string;
  readonly driver: string;
  readonly model: string;
  readonly effort: string | null;
  readonly label: string;
  readonly rating: number;
  /** A rough ± that shrinks as head-to-heads accumulate; not a statistical interval. */
  readonly spread: number;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly provisional: boolean;
}

/**
 * Who won a heat: what the user kept, else the judge's pick. A heat closed
 * with no winner, or judged "none", has no head-to-heads.
 */
export function raceHeatWinner(heat: RaceHeatView): number | null {
  if (heat.outcome === "kept" && heat.keptSlot !== null) return heat.keptSlot;
  if (heat.outcome === "none") return null;
  return heat.judge?.pickSlot ?? null;
}

/**
 * Elo-style ratings per harness+model. Each decided heat counts its winner as
 * beating every other entrant in it, failed entrants included; heats are
 * replayed oldest first so the ratings move the way the races happened.
 */
export function buildRaceLadder(
  records: ReadonlyArray<RaceHistoryRecord>,
  filter: { readonly taskKind?: RaceTaskKind | null } = {},
): RaceLadderRow[] {
  const ratings = new Map<
    string,
    {
      driver: string;
      model: string;
      effort: string | null;
      label: string;
      rating: number;
      wins: number;
      losses: number;
    }
  >();
  const heats = records
    .filter((record) => !filter.taskKind || record.taskKind === filter.taskKind)
    .flatMap((record) => raceHeats(record).map((heat) => ({ record, heat })))
    .toSorted((left, right) => left.heat.startedAt.localeCompare(right.heat.startedAt));
  const entryFor = (entrant: RaceHistoryEntrant) => {
    const key = raceAgentKey(entrant);
    const entry = ratings.get(key) ?? {
      driver: entrant.driver,
      model: entrant.model,
      effort: entrant.effort ?? null,
      label: entrant.label,
      rating: RACE_LADDER_START_RATING,
      wins: 0,
      losses: 0,
    };
    entry.label = entrant.label;
    ratings.set(key, entry);
    return entry;
  };
  for (const { record, heat } of heats) {
    const winnerSlot = raceHeatWinner(heat);
    if (winnerSlot === null) continue;
    const bySlot = new Map(record.entrants.map((entrant) => [entrant.slot, entrant] as const));
    const winnerEntrant = bySlot.get(winnerSlot);
    if (!winnerEntrant) continue;
    const winner = entryFor(winnerEntrant);
    for (const slot of heat.participants) {
      if (slot === winnerSlot) continue;
      const loserEntrant = bySlot.get(slot);
      if (!loserEntrant) continue;
      const loser = entryFor(loserEntrant);
      // Two runs of the same harness+model in one heat say nothing about it.
      if (loser === winner) continue;
      const expected = 1 / (1 + 10 ** ((loser.rating - winner.rating) / 400));
      const delta = RACE_LADDER_K * (1 - expected);
      winner.rating += delta;
      loser.rating -= delta;
      winner.wins += 1;
      loser.losses += 1;
    }
  }
  return [...ratings.entries()]
    .map(([key, entry]) => {
      const games = entry.wins + entry.losses;
      return {
        key,
        driver: entry.driver,
        model: entry.model,
        effort: entry.effort,
        label: entry.label,
        rating: Math.round(entry.rating),
        spread: Math.round(350 / Math.sqrt(1 + games)),
        games,
        wins: entry.wins,
        losses: entry.losses,
        provisional: games < RACE_LADDER_PROVISIONAL_GAMES,
      };
    })
    .toSorted(
      (left, right) =>
        right.rating - left.rating ||
        right.games - left.games ||
        left.label.localeCompare(right.label),
    );
}

export interface RaceRecommendation {
  readonly row: RaceLadderRow;
  /** Whether the rating comes from this kind of task or, lacking that, from every race. */
  readonly scope: "kind" | "overall";
}

/**
 * The best-rated agents for a kind of task among those the user can run now.
 * Kind-specific ratings win; with no head-to-heads in that kind yet, the
 * overall ladder stands in, and says so. Unrated agents are never suggested.
 */
export function recommendRaceEntrants(
  records: ReadonlyArray<RaceHistoryRecord>,
  taskKind: RaceTaskKind,
  available: ReadonlyArray<{ readonly driver: string; readonly model: string }>,
  count = 2,
): RaceRecommendation[] {
  const runnable = (row: RaceLadderRow) =>
    row.games > 0 &&
    // Effort is a setting on a runnable model, so a model being available is enough.
    available.some((item) => item.driver === row.driver && item.model === row.model);
  const byKind = buildRaceLadder(records, { taskKind }).filter(runnable);
  if (byKind.length > 0) {
    return byKind.slice(0, count).map((row) => ({ row, scope: "kind" as const }));
  }
  return buildRaceLadder(records)
    .filter(runnable)
    .slice(0, count)
    .map((row) => ({ row, scope: "overall" as const }));
}

// ---------------------------------------------------------------------------
// Prompt history: every run of the same prompt
// ---------------------------------------------------------------------------

/** Same words, same task: case and spacing don't make a different prompt. */
export function racePromptKey(prompt: string): string {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

export interface RacePromptRun<R extends RaceHistoryRecord = RaceHistoryRecord> {
  readonly record: R;
  readonly heat: RaceHeatView;
  readonly entrants: ReadonlyArray<RaceHistoryEntrant>;
  readonly winnerSlot: number | null;
}

/** Every heat of every race on this prompt, newest first. */
export function buildRacePromptRuns<R extends RaceHistoryRecord>(
  records: ReadonlyArray<R>,
  promptKey: string,
): RacePromptRun<R>[] {
  return records
    .filter((record) => racePromptKey(record.prompt) === promptKey)
    .flatMap((record) =>
      raceHeats(record).map((heat) => ({
        record,
        heat,
        entrants: record.entrants.filter((entrant) => heat.participants.includes(entrant.slot)),
        winnerSlot: raceHeatWinner(heat),
      })),
    )
    .toSorted((left, right) => right.heat.startedAt.localeCompare(left.heat.startedAt));
}
