/* agent-watermark: model=opus-5.5; effort=high; duration=110m; seat=claude-code; date=2026-10-04 */
import {
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ServerProvider,
  type VcsIntegrateWorktreeResult,
} from "@t3tools/contracts";
import { parseRaceBranchName, RACE_MAX_ENTRANTS, RACE_MIN_ENTRANTS } from "@t3tools/shared/race";

import { missionProviders as raceProviders } from "../command-center/missionLauncher.logic";

export { raceProviders };

/** Minimal thread fields the board needs; `EnvironmentThreadShell` satisfies it. */
export interface RaceThreadInput {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly modelSelection: ModelSelection;
  readonly session: { readonly status: string } | null;
  readonly latestTurn: { readonly state: string; readonly completedAt: string | null } | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
}

export interface RaceEntrant<T extends RaceThreadInput = RaceThreadInput> {
  readonly slot: number;
  readonly thread: T;
}

export interface RaceGroup<T extends RaceThreadInput = RaceThreadInput> {
  readonly key: string;
  readonly raceId: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly count: number;
  readonly titleSeed: string;
  readonly startedAt: string;
  readonly entrants: ReadonlyArray<RaceEntrant<T>>;
}

const TITLE_SEPARATOR = " · ";

/** Keep the owning environment in links: race ids may repeat across computers. */
export function raceArenaTarget(
  thread: { readonly branch: string | null; readonly environmentId: EnvironmentId } | null,
) {
  const identity = parseRaceBranchName(thread?.branch);
  return identity && thread
    ? { to: "/race" as const, search: { race: identity.raceId, env: thread.environmentId } }
    : null;
}

export function buildRaceEntrantTitle(titleSeed: string, entrantLabel: string): string {
  return `${titleSeed}${TITLE_SEPARATOR}${entrantLabel}`;
}

/** Recovers the shared prompt title from "<seed> · <provider model>". */
export function raceTitleSeed(title: string): string {
  const index = title.lastIndexOf(TITLE_SEPARATOR);
  return index > 0 ? title.slice(0, index) : title;
}

/** Groups non-archived threads by the race encoded in their branch, newest race first. */
export function groupRaces<T extends RaceThreadInput>(
  threads: ReadonlyArray<T>,
): ReadonlyArray<RaceGroup<T>> {
  const groups = new Map<string, { identityCount: number; entrants: RaceEntrant<T>[] }>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const identity = parseRaceBranchName(thread.branch);
    if (!identity) continue;
    const key = `${thread.environmentId}\0${identity.raceId}`;
    const group = groups.get(key) ?? { identityCount: identity.count, entrants: [] };
    group.identityCount = Math.max(group.identityCount, identity.count);
    group.entrants.push({ slot: identity.slot, thread });
    groups.set(key, group);
  }
  const races: RaceGroup<T>[] = [];
  for (const [key, group] of groups) {
    const entrants = group.entrants.toSorted((left, right) => left.slot - right.slot);
    const first = entrants[0]!;
    const startedAt = entrants.reduce(
      (earliest, entrant) =>
        entrant.thread.createdAt < earliest ? entrant.thread.createdAt : earliest,
      first.thread.createdAt,
    );
    races.push({
      key,
      raceId: key.slice(key.indexOf("\0") + 1),
      environmentId: first.thread.environmentId,
      projectId: first.thread.projectId,
      count: group.identityCount,
      titleSeed: raceTitleSeed(first.thread.title),
      startedAt,
      entrants,
    });
  }
  return races.toSorted(
    (left, right) =>
      right.startedAt.localeCompare(left.startedAt) || left.key.localeCompare(right.key),
  );
}

export type RaceEntrantPhase = "preparing" | "working" | "attention" | "failed" | "finished";

export function raceEntrantPhase(thread: RaceThreadInput): RaceEntrantPhase {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "attention";
  const status = thread.session?.status;
  if (status === "running" || status === "starting") return "working";
  if (status === "error" || thread.latestTurn?.state === "error") return "failed";
  if (thread.latestTurn === null || thread.worktreePath === null) return "preparing";
  if (thread.latestTurn.completedAt === null && thread.latestTurn.state === "running") {
    return "working";
  }
  return "finished";
}

/** Keeping merges the worktree, so it waits until the entrant has stopped writing to it. */
export function canKeepRaceEntrant(thread: RaceThreadInput): boolean {
  const phase = raceEntrantPhase(thread);
  return (
    (phase === "finished" || phase === "failed") &&
    thread.worktreePath !== null &&
    thread.branch !== null
  );
}

export interface RaceEntrantDraft {
  readonly instanceId: string;
  readonly model: string;
}

function defaultModelSlug(provider: ServerProvider): string {
  return (provider.models.find((model) => model.isDefault) ?? provider.models[0])?.slug ?? "";
}

/**
 * Two entrants by default, preferring different providers so the comparison
 * says something; falls back to the same provider twice.
 */
export function defaultRaceEntrants(
  providers: ReadonlyArray<ServerProvider>,
  preferred: ModelSelection | null | undefined,
): RaceEntrantDraft[] {
  const ready = raceProviders(providers);
  if (ready.length === 0) return [];
  const first =
    ready.find((provider) => provider.instanceId === preferred?.instanceId) ?? ready[0]!;
  const firstModel =
    first.models.find((model) => model.slug === preferred?.model)?.slug ?? defaultModelSlug(first);
  const second = ready.find((provider) => provider.instanceId !== first.instanceId) ?? first;
  const secondModel =
    second === first
      ? (first.models.find((model) => model.slug !== firstModel)?.slug ?? firstModel)
      : defaultModelSlug(second);
  return [
    { instanceId: first.instanceId, model: firstModel },
    { instanceId: second.instanceId, model: secondModel },
  ];
}

/** Adds an entrant on the next provider not yet in the race, else repeats the last one. */
export function nextRaceEntrant(
  providers: ReadonlyArray<ServerProvider>,
  entrants: ReadonlyArray<RaceEntrantDraft>,
): RaceEntrantDraft | null {
  if (entrants.length >= RACE_MAX_ENTRANTS) return null;
  const ready = raceProviders(providers);
  const unused = ready.find(
    (provider) => !entrants.some((entrant) => entrant.instanceId === provider.instanceId),
  );
  if (unused) return { instanceId: unused.instanceId, model: defaultModelSlug(unused) };
  const last = entrants.at(-1);
  if (last) return last;
  const fallback = ready[0];
  return fallback ? { instanceId: fallback.instanceId, model: defaultModelSlug(fallback) } : null;
}

export type RaceDraftValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export function validateRaceDraft(input: {
  readonly hasProject: boolean;
  readonly connected: boolean;
  readonly isRepo: boolean | null;
  readonly baseBranch: string;
  readonly prompt: string;
  readonly entrants: ReadonlyArray<RaceEntrantDraft>;
  readonly providers: ReadonlyArray<ServerProvider>;
}): RaceDraftValidation {
  if (!input.hasProject) return { ok: false, reason: "Choose a project to race in." };
  if (!input.connected) return { ok: false, reason: "Connect this computer to start a race." };
  if (input.isRepo === false) {
    return { ok: false, reason: "Races need a git repository so each entrant gets a worktree." };
  }
  if (input.baseBranch.trim().length === 0) return { ok: false, reason: "Choose a base branch." };
  if (input.prompt.trim().length === 0) return { ok: false, reason: "Describe the task." };
  if (input.entrants.length < RACE_MIN_ENTRANTS || input.entrants.length > RACE_MAX_ENTRANTS) {
    return {
      ok: false,
      reason: `A race needs ${RACE_MIN_ENTRANTS} to ${RACE_MAX_ENTRANTS} entrants.`,
    };
  }
  const ready = raceProviders(input.providers);
  for (const [index, entrant] of input.entrants.entries()) {
    const provider = ready.find((item) => item.instanceId === entrant.instanceId);
    if (!provider) {
      return { ok: false, reason: `Entrant ${index + 1}: choose a ready provider.` };
    }
    if (!provider.models.some((model) => model.slug === entrant.model)) {
      return { ok: false, reason: `Entrant ${index + 1}: choose a model.` };
    }
  }
  return { ok: true };
}

/** The `vcs.integrateWorktree` result, named for this page's vocabulary. */
export type RaceIntegrateResult = VcsIntegrateWorktreeResult;

export interface RaceKeepMessage {
  readonly tone: "success" | "warning";
  readonly title: string;
  readonly description: string;
  /** Only a merge settles the race; every other outcome keeps all entrants. */
  readonly discardOthers: boolean;
}

function listFiles(files: ReadonlyArray<string>): string {
  const shown = files.slice(0, 3).join(", ");
  const rest = files.length - 3;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

function excerpt(text: string, maxLength = 160): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}

const RESTORED_AFTER_COMMIT =
  "The project checkout was restored. The entrant's work is now committed on its own branch, and every entrant is still here.";

/**
 * Toast copy for a Keep. Each sentence states only what the server guarantees
 * for that outcome: refusals before the merge change nothing; conflict and
 * rejected happen after the entrant's work was committed on its branch.
 */
export function describeRaceKeepResult(
  result: RaceIntegrateResult,
  checkoutBranch: string | null,
): RaceKeepMessage {
  const target = checkoutBranch ?? "the project checkout";
  const keep = (title: string, description: string): RaceKeepMessage => ({
    tone: "warning",
    title,
    description,
    discardOthers: false,
  });
  switch (result.status) {
    case "merged":
      return {
        tone: "success",
        title: `Merged into ${target}`,
        description: `${result.filesChanged} ${result.filesChanged === 1 ? "file" : "files"} changed in ${result.commitSha.slice(0, 7)}.`,
        discardOthers: true,
      };
    case "nothing_to_merge":
      return keep("Nothing to keep", "This entrant has no changes to merge. Nothing was merged.");
    case "base_dirty":
      return keep(
        "The project checkout has uncommitted changes",
        `Commit or stash ${listFiles(result.files)} in the project checkout, then keep again. Nothing was changed.`,
      );
    case "base_moved":
      return keep(
        "The project checkout changed branch",
        `${result.current ? `It is on ${result.current}` : "It has a detached HEAD"}${result.expected ? `, not ${result.expected}` : ""}. Switch the checkout to ${result.expected ?? "the race's base branch"} and keep again. Nothing was changed.`,
      );
    case "branch_mismatch":
      return keep(
        "The entrant left its race branch",
        `Its worktree is ${result.current ? `on ${result.current}` : "on a detached HEAD"}. Switch it back to its race branch in the entrant's thread, then keep again. Nothing was changed.`,
      );
    case "conflict":
      return keep(
        "Merge conflict",
        `${listFiles(result.files)} conflict with ${target}. ${RESTORED_AFTER_COMMIT}`,
      );
    case "rejected":
      return keep(
        "The merge commit was rejected",
        `${excerpt(result.reason)} ${RESTORED_AFTER_COMMIT}`,
      );
  }
}

/** Confirmation text for Keep; warns when this session already merged another entrant. */
export function raceKeepConfirmation(input: {
  readonly entrantLabel: string;
  readonly target: string;
  readonly otherCount: number;
  readonly previouslyKeptLabel: string | null;
}): string {
  const lines = [
    `Keep ${input.entrantLabel}?`,
    `Its changes are committed and squash-merged into ${input.target}.`,
  ];
  if (input.previouslyKeptLabel) {
    lines.push(
      `${input.previouslyKeptLabel} from this race was already merged. Keeping this one adds a second squash commit on top.`,
    );
  }
  if (input.otherCount > 0) {
    lines.push(
      `The other ${input.otherCount === 1 ? "entrant is" : `${input.otherCount} entrants are`} then deleted with ${input.otherCount === 1 ? "its worktree" : "their worktrees"}.`,
    );
  }
  return lines.join("\n");
}

export interface RaceProjectOption {
  readonly key: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly environmentLabel: string;
}

function pathTail(path: string, segments: number): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length <= segments ? path : `…/${parts.slice(-segments).join("/")}`;
}

/**
 * "<title> · <computer>" for each project; projects that would read identically
 * get a path tail long enough to tell them apart.
 */
export function raceProjectLabels(
  options: ReadonlyArray<RaceProjectOption>,
): ReadonlyMap<string, string> {
  const base = (option: RaceProjectOption) => `${option.title} · ${option.environmentLabel}`;
  const counts = new Map<string, number>();
  for (const option of options) counts.set(base(option), (counts.get(base(option)) ?? 0) + 1);
  const labels = new Map<string, string>();
  for (const option of options) {
    const label = base(option);
    if (counts.get(label) === 1) {
      labels.set(option.key, label);
      continue;
    }
    const twins = options.filter((other) => base(other) === label);
    let segments = 3;
    while (
      segments < 12 &&
      new Set(twins.map((twin) => pathTail(twin.workspaceRoot, segments))).size < twins.length
    ) {
      segments += 1;
    }
    labels.set(option.key, `${option.title} — ${pathTail(option.workspaceRoot, segments)}`);
  }
  return labels;
}
