/* agent-watermark: model=opus-5.5; effort=high; duration=72m; seat=claude-code; date=2026-10-04 */
import { WORKTREE_BRANCH_PREFIX } from "./git.ts";

/**
 * Race identity lives entirely in the entrant's branch name, so a race needs
 * no storage of its own: `t3code/race-<raceId>-<slot>of<count>`.
 */
export const RACE_MIN_ENTRANTS = 2;
export const RACE_MAX_ENTRANTS = 4;
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
    count <= RACE_MAX_ENTRANTS &&
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
