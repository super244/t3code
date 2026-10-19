/* agent-watermark: model=opus-5.5; effort=high; duration=4m; seat=claude-code; date=2026-10-19 */
/* agent-watermark: model=opus-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-18 */
/* agent-watermark: model=opus-5.5; effort=high; duration=72m; seat=claude-code; date=2026-10-04 */
import { WORKTREE_BRANCH_PREFIX } from "./git.ts";

/**
 * Race identity lives entirely in the entrant's branch name, so a race needs
 * no storage of its own: `t3code/race-<raceId>-<slot>of<count>`.
 */
export const RACE_MIN_ENTRANTS = 2;
export const RACE_MAX_ENTRANTS = 4;
/**
 * Rematches append entrants to a finished race, so a race can grow past the
 * four a new race starts with; the branch name's single-digit slot caps it.
 */
export const RACE_MAX_SLOTS = 9;
const RACE_ID_LENGTH = 6;
const RACE_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

const RACE_BRANCH_PATTERN = new RegExp(
  `^${WORKTREE_BRANCH_PREFIX}\\/race-([0-9a-z]{${RACE_ID_LENGTH}})-([1-9])of([1-9])$`,
);

export interface RaceIdentity {
  readonly raceId: string;
  readonly slot: number;
  readonly count: number;
}

function isValidRaceId(raceId: string): boolean {
  return raceId.length === RACE_ID_LENGTH && /^[0-9a-z]+$/.test(raceId);
}

function isValidPosition(slot: number, count: number): boolean {
  return (
    Number.isInteger(slot) &&
    Number.isInteger(count) &&
    count >= RACE_MIN_ENTRANTS &&
    count <= RACE_MAX_SLOTS &&
    slot >= 1 &&
    slot <= count
  );
}

export function buildRaceBranchName(identity: RaceIdentity): string {
  if (!isValidRaceId(identity.raceId) || !isValidPosition(identity.slot, identity.count)) {
    throw new Error(`Invalid race identity: ${identity.raceId} ${identity.slot}/${identity.count}`);
  }
  return `${WORKTREE_BRANCH_PREFIX}/race-${identity.raceId}-${identity.slot}of${identity.count}`;
}

export function parseRaceBranchName(branch: string | null | undefined): RaceIdentity | null {
  if (!branch) return null;
  const match = RACE_BRANCH_PATTERN.exec(branch.trim());
  if (!match) return null;
  const slot = Number(match[2]);
  const count = Number(match[3]);
  if (!isValidPosition(slot, count)) return null;
  return { raceId: match[1]!, slot, count };
}

/** Six lowercase base36 characters. `randomBytes` is injectable for tests. */
export function createRaceId(
  randomBytes: (length: number) => Uint8Array = (length) =>
    globalThis.crypto.getRandomValues(new Uint8Array(length)),
): string {
  const bytes = randomBytes(RACE_ID_LENGTH);
  let id = "";
  for (let index = 0; index < RACE_ID_LENGTH; index += 1) {
    id += RACE_ID_ALPHABET[(bytes[index] ?? 0) % RACE_ID_ALPHABET.length];
  }
  return id;
}

/**
 * A race judge is an ordinary thread in the project checkout whose first
 * message is a brief naming the race. Like the race itself it needs no storage:
 * its title finds candidates and the marker line confirms the race.
 */
const RACE_JUDGE_TITLE_PREFIX = "Judge · ";
const RACE_JUDGE_MARKER_PATTERN = /^\[Judge of race ([0-9a-z]{6})(?: heat ([1-9]))?\]/;
const RACE_JUDGE_VERDICT_PATTERN = /^[\s>*_#-]*winner[\s*_]*:[\s*_]*(?:entrant\s*)?#?(\d)\b/im;
const RACE_JUDGE_NO_WINNER_PATTERN =
  /^[\s>*_#-]*winner[\s*_]*:[\s*_]*(?:none|no winner|neither)\b/im;
const JUDGE_PROMPT_CLIP_CHARS = 3_000;
const JUDGE_MESSAGE_CLIP_CHARS = 1_500;
const JUDGE_DIFF_CLIP_CHARS = 6_000;
const JUDGE_MAX_FILES = 30;

export interface RaceJudgeEntrant {
  readonly slot: number;
  /** e.g. "Claude Sonnet 5.5". */
  readonly label: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  /** "finished", "failed", … as the board shows it. */
  readonly phase: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }>;
  readonly diff: string;
  readonly finalMessage: string | null;
}

export interface RaceJudgeBriefInput {
  readonly raceId: string;
  /** A rematch heat (2+); the original race when absent. */
  readonly heat?: number;
  readonly prompt: string;
  readonly entrants: ReadonlyArray<RaceJudgeEntrant>;
  readonly focus?: string | null;
}

function clipText(text: string, limit: number): string {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit).trimEnd()}\n… [clipped ${clean.length - limit} chars]`;
}

function quoteText(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

export function buildRaceJudgeTitle(titleSeed: string): string {
  return `${RACE_JUDGE_TITLE_PREFIX}${titleSeed.trim() || "Race"}`;
}

/** The race a judge brief belongs to, read from its marker line. */
/** Which heat a judge brief judges: 1 (the original race) unless it names a rematch. */
export function parseRaceJudgeHeat(firstMessageText: string | null | undefined): number | null {
  const match = RACE_JUDGE_MARKER_PATTERN.exec((firstMessageText ?? "").trimStart());
  return match ? Number(match[2] ?? 1) : null;
}

export function parseRaceJudgeMarker(firstMessageText: string | null | undefined): string | null {
  const match = RACE_JUDGE_MARKER_PATTERN.exec((firstMessageText ?? "").trimStart());
  return match ? match[1]! : null;
}

export type RaceJudgeVerdict =
  | { readonly kind: "winner"; readonly slot: number }
  | { readonly kind: "none" };

/** Reads the judge's `Winner: Entrant N` line; null until it has written one. */
export function parseRaceJudgeVerdict(
  text: string | null | undefined,
  entrantSlots: ReadonlyArray<number>,
): RaceJudgeVerdict | null {
  const body = text ?? "";
  const lines = body.split("\n");
  // The last verdict line wins, so a judge that changes its mind is read correctly.
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    const winner = RACE_JUDGE_VERDICT_PATTERN.exec(line);
    if (winner) {
      const slot = Number(winner[1]);
      return entrantSlots.includes(slot) ? { kind: "winner", slot } : null;
    }
    if (RACE_JUDGE_NO_WINNER_PATTERN.test(line)) return { kind: "none" };
  }
  return null;
}

/** The judge's first message: the task, every entrant's work, and how to answer. */
export function buildRaceJudgeBrief(input: RaceJudgeBriefInput): string {
  const lines = [
    input.heat && input.heat > 1
      ? `[Judge of race ${input.raceId} heat ${input.heat}]`
      : `[Judge of race ${input.raceId}]`,
    "",
    `${input.entrants.length} coding agents were given the same task, each in its own git worktree. Compare their work and pick the one to keep. This is a read-only review: do not edit files, commit, or run commands that change state in any worktree.`,
    "",
    "## The task",
    quoteText(clipText(input.prompt, JUDGE_PROMPT_CLIP_CHARS)),
  ];
  for (const entrant of input.entrants) {
    lines.push("", `## Entrant ${entrant.slot}: ${entrant.label}`);
    const where = [
      entrant.worktreePath ? `worktree \`${entrant.worktreePath}\`` : null,
      entrant.branch ? `branch \`${entrant.branch}\`` : null,
    ].filter(Boolean);
    lines.push(
      `Status: ${entrant.phase}.${where.length > 0 ? ` Its work is in ${where.join(", ")}.` : ""}`,
    );
    if (entrant.files.length === 0) {
      lines.push("It changed no files.");
    } else {
      lines.push("Changed files:");
      for (const file of entrant.files.slice(0, JUDGE_MAX_FILES)) {
        lines.push(`- \`${file.path}\` +${file.additions} −${file.deletions}`);
      }
      if (entrant.files.length > JUDGE_MAX_FILES) {
        lines.push(`- …and ${entrant.files.length - JUDGE_MAX_FILES} more`);
      }
    }
    if (entrant.finalMessage?.trim()) {
      lines.push(
        "",
        "What it says it did:",
        quoteText(clipText(entrant.finalMessage, JUDGE_MESSAGE_CLIP_CHARS)),
      );
    }
    if (entrant.diff.trim()) {
      lines.push("", "```diff", clipText(entrant.diff, JUDGE_DIFF_CLIP_CHARS), "```");
    }
  }
  lines.push(
    "",
    "## How to judge",
    "Read each worktree in full where the diff above is clipped (`git -C <worktree> status`, `git -C <worktree> diff HEAD`, and `git -C <worktree> log -3 -p` for anything committed). Run each entrant's tests or checks read-only when that settles a question. Judge correctness first, then whether it did the whole task, then the size and clarity of the change.",
    "",
    "## Your answer",
    "One short paragraph per entrant: what it got right, what it got wrong (with `file:line`), and anything missing. Then a final line on its own, exactly `Winner: Entrant N` — or `Winner: none` if no entrant should be kept.",
  );
  if (input.focus?.trim()) lines.push("", `Weigh especially: ${input.focus.trim()}`);
  return lines.join("\n").trim();
}
