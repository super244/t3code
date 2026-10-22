/* agent-watermark: model=opus-5.5; effort=high; duration=4m; seat=claude-code; date=2026-10-19 */
/* agent-watermark: model=opus-5.5; effort=high; duration=40m; seat=claude-code; date=2026-10-18 */
/**
 * Pure helpers behind the Race Arena: splitting each entrant's worktree diff
 * into files, lining the files up across entrants, and condensing a thread
 * into the short live feed a lane shows.
 */

export type RaceDiffChange = "added" | "deleted" | "renamed" | "modified";

export interface RaceDiffFile {
  readonly path: string;
  readonly previousPath: string | null;
  readonly change: RaceDiffChange;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
  /** The file's own `diff --git` section(s), ready to render. */
  readonly patch: string;
}

function stripSidePrefix(raw: string): string {
  const value = raw.trim().replace(/^"(.*)"$/, "$1");
  return value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;
}

function parseSection(section: string): RaceDiffFile | null {
  const lines = section.split("\n");
  const header = lines[0] ?? "";
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let change: RaceDiffChange = "modified";
  let binary = false;
  let additions = 0;
  let deletions = 0;
  let inHunk = false;

  for (const line of lines.slice(1)) {
    if (inHunk) {
      if (line.startsWith("+")) additions += 1;
      else if (line.startsWith("-")) deletions += 1;
      else if (line.startsWith("@@")) continue;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
    } else if (line.startsWith("--- ")) {
      const value = line.slice(4);
      oldPath = value.trim() === "/dev/null" ? null : stripSidePrefix(value);
    } else if (line.startsWith("+++ ")) {
      const value = line.slice(4);
      newPath = value.trim() === "/dev/null" ? null : stripSidePrefix(value);
    } else if (line.startsWith("rename from ")) {
      renameFrom = line.slice("rename from ".length).trim();
    } else if (line.startsWith("rename to ")) {
      renameTo = line.slice("rename to ".length).trim();
    } else if (line.startsWith("new file mode")) {
      change = "added";
    } else if (line.startsWith("deleted file mode")) {
      change = "deleted";
    } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      binary = true;
    }
  }

  // `diff --git a/x b/x` names both sides even when no ---/+++ lines follow
  // (binary or mode-only changes).
  const headerMatch = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(header);
  const fallbackOld = headerMatch?.[1] ?? null;
  const fallbackNew = headerMatch?.[2] ?? null;

  if (renameFrom !== null || renameTo !== null) change = "renamed";
  const path =
    renameTo ??
    newPath ??
    (change === "deleted" ? (oldPath ?? fallbackOld) : null) ??
    fallbackNew ??
    oldPath ??
    fallbackOld;
  if (!path) return null;
  if (
    change === "modified" &&
    oldPath === null &&
    newPath !== null &&
    lines.some((l) => l === "--- /dev/null")
  ) {
    change = "added";
  }
  if (
    change === "modified" &&
    newPath === null &&
    oldPath !== null &&
    lines.some((l) => l === "+++ /dev/null")
  ) {
    change = "deleted";
  }
  const previousPath = change === "renamed" ? (renameFrom ?? oldPath ?? fallbackOld) : null;
  return {
    path,
    previousPath,
    change,
    additions,
    deletions,
    binary,
    patch: section.trimEnd(),
  };
}

/** Splits a unified `git diff` into one entry per file, in diff order. */
export function splitUnifiedDiff(diff: string): RaceDiffFile[] {
  if (!diff.trim()) return [];
  const sections: string[] = [];
  let current: string[] | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) sections.push(current.join("\n"));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) sections.push(current.join("\n"));
  return sections.flatMap((section) => {
    const file = parseSection(section);
    return file ? [file] : [];
  });
}

export interface RaceEntrantChanges {
  readonly files: ReadonlyArray<
    RaceDiffFile & { readonly committed: boolean; readonly uncommitted: boolean }
  >;
  readonly additions: number;
  readonly deletions: number;
  readonly truncated: boolean;
}

/**
 * An entrant's work is whatever it committed on its race branch plus whatever
 * is still uncommitted in its worktree. A file in both keeps both patches.
 */
export function combineEntrantChanges(input: {
  readonly committed: string | null | undefined;
  readonly uncommitted: string | null | undefined;
  readonly truncated?: boolean;
}): RaceEntrantChanges {
  const byPath = new Map<string, RaceDiffFile & { committed: boolean; uncommitted: boolean }>();
  const add = (files: ReadonlyArray<RaceDiffFile>, side: "committed" | "uncommitted") => {
    for (const file of files) {
      const existing = byPath.get(file.path);
      if (!existing) {
        byPath.set(file.path, {
          ...file,
          committed: side === "committed",
          uncommitted: side === "uncommitted",
        });
        continue;
      }
      byPath.set(file.path, {
        ...existing,
        change: existing.change === "added" ? "added" : file.change,
        additions: existing.additions + file.additions,
        deletions: existing.deletions + file.deletions,
        binary: existing.binary || file.binary,
        patch: `${existing.patch}\n${file.patch}`,
        committed: existing.committed || side === "committed",
        uncommitted: existing.uncommitted || side === "uncommitted",
      });
    }
  };
  add(splitUnifiedDiff(input.committed ?? ""), "committed");
  add(splitUnifiedDiff(input.uncommitted ?? ""), "uncommitted");
  const files = [...byPath.values()].toSorted((left, right) => left.path.localeCompare(right.path));
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    truncated: input.truncated === true,
  };
}

export interface RaceFileMatrixRow<F extends RaceDiffFile = RaceDiffFile> {
  readonly path: string;
  /** One cell per entrant, in the order given; null when that entrant left the file alone. */
  readonly cells: ReadonlyArray<F | null>;
  readonly touchedBy: number;
  readonly churn: number;
}

export interface RaceFileMatrix<F extends RaceDiffFile = RaceDiffFile> {
  readonly rows: ReadonlyArray<RaceFileMatrixRow<F>>;
  /** Files every entrant with changes touched. */
  readonly sharedCount: number;
  /** Per entrant: files only that entrant touched. */
  readonly uniqueCounts: ReadonlyArray<number>;
}

/**
 * Lines files up across entrants. Files more entrants touched come first (where
 * they agree on the shape of the fix), then by size, then by path.
 */
export function buildRaceFileMatrix<F extends RaceDiffFile>(
  entrants: ReadonlyArray<ReadonlyArray<F> | null>,
): RaceFileMatrix<F> {
  const paths = new Map<string, Array<F | null>>();
  entrants.forEach((files, index) => {
    for (const file of files ?? []) {
      const cells = paths.get(file.path) ?? entrants.map(() => null);
      cells[index] = file;
      paths.set(file.path, cells);
    }
  });
  const rows = [...paths.entries()]
    .map(([path, cells]) => ({
      path,
      cells,
      touchedBy: cells.filter((cell) => cell !== null).length,
      churn: cells.reduce((sum, cell) => sum + (cell ? cell.additions + cell.deletions : 0), 0),
    }))
    .toSorted(
      (left, right) =>
        right.touchedBy - left.touchedBy ||
        right.churn - left.churn ||
        left.path.localeCompare(right.path),
    );
  const withChanges = entrants.filter((files) => files !== null && files.length > 0).length;
  return {
    rows,
    sharedCount: withChanges >= 2 ? rows.filter((row) => row.touchedBy === withChanges).length : 0,
    uniqueCounts: entrants.map(
      (_, index) => rows.filter((row) => row.touchedBy === 1 && row.cells[index] !== null).length,
    ),
  };
}

export interface RaceTurnTiming {
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

/** How long the entrant has been (or was) working on its current turn. */
export function raceEntrantElapsedMs(turn: RaceTurnTiming | null, nowMs: number): number | null {
  if (!turn) return null;
  const start = Date.parse(turn.startedAt ?? turn.requestedAt);
  if (Number.isNaN(start)) return null;
  const end = turn.completedAt ? Date.parse(turn.completedAt) : nowMs;
  if (Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

export function formatRaceDuration(ms: number | null): string {
  if (ms === null) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export interface RaceFeedMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly streaming: boolean;
  readonly createdAt: string;
}

export interface RaceFeedWork {
  readonly id: string;
  readonly createdAt: string;
  readonly label: string;
  readonly detail?: string | undefined;
  readonly command?: string | undefined;
  readonly tone: "thinking" | "tool" | "info" | "error";
}

export type RaceFeedItem =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly role: "user" | "assistant";
      readonly text: string;
      readonly streaming: boolean;
      readonly createdAt: string;
    }
  | {
      readonly kind: "work";
      readonly id: string;
      readonly label: string;
      readonly detail: string | null;
      readonly tone: RaceFeedWork["tone"];
      readonly createdAt: string;
    };

/**
 * A lane's feed: everything after the shared race prompt, oldest first, capped
 * to the most recent `limit` items so a long run stays cheap to render.
 */
export function buildRaceEntrantFeed(input: {
  readonly messages: ReadonlyArray<RaceFeedMessage>;
  readonly work: ReadonlyArray<RaceFeedWork>;
  readonly limit?: number;
}): { readonly items: ReadonlyArray<RaceFeedItem>; readonly hiddenCount: number } {
  const limit = input.limit ?? 40;
  const firstUser = input.messages.find((message) => message.role === "user");
  const items: RaceFeedItem[] = [];
  for (const message of input.messages) {
    if (message === firstUser || message.role === "system") continue;
    if (message.text.trim().length === 0 && !message.streaming) continue;
    items.push({
      kind: "message",
      id: message.id,
      role: message.role,
      text: message.text,
      streaming: message.streaming,
      createdAt: message.createdAt,
    });
  }
  for (const entry of input.work) {
    const detail = entry.command ?? entry.detail ?? null;
    items.push({
      kind: "work",
      id: entry.id,
      label: entry.label,
      detail: detail && detail.trim().length > 0 ? detail.trim() : null,
      tone: entry.tone,
      createdAt: entry.createdAt,
    });
  }
  const ordered = items.toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  const hiddenCount = Math.max(0, ordered.length - limit);
  return { items: ordered.slice(hiddenCount), hiddenCount };
}

export type RaceJudgePhase = "starting" | "judging" | "attention" | "failed" | "done";

/**
 * A judge works in the project checkout, so unlike an entrant it never gets a
 * worktree; its phase comes from the session and turn alone.
 */
export function raceJudgePhase(thread: {
  readonly session: { readonly status: string } | null;
  readonly latestTurn: { readonly state: string; readonly completedAt: string | null } | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
}): RaceJudgePhase {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "attention";
  const status = thread.session?.status;
  if (status === "error" || thread.latestTurn?.state === "error") return "failed";
  if (thread.latestTurn === null)
    return status === "starting" || status === "running" ? "judging" : "starting";
  if (thread.latestTurn.state === "running" && thread.latestTurn.completedAt === null)
    return "judging";
  if (status === "running" || status === "starting") return "judging";
  return "done";
}

/**
 * The cost a provider reported for an entrant's session, or null when it
 * reported none. Claude's SDK reports a running session total with each
 * turn, so the largest value is the session's cost so far.
 */
export function reportedSessionCostUsd(
  activities: ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>,
): number | null {
  let cost: number | null = null;
  for (const activity of activities) {
    if (activity.kind !== "turn.cost") continue;
    const value = (activity.payload as { readonly totalCostUsd?: unknown } | null)?.totalCostUsd;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    cost = cost === null ? value : Math.max(cost, value);
  }
  return cost;
}

export function formatRaceCost(costUsd: number | null): string {
  if (costUsd === null) return "—";
  if (costUsd < 0.01) return "<$0.01";
  return `$${costUsd.toFixed(costUsd < 1 ? 3 : 2)}`;
}
