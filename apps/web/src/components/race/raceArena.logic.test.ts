/* agent-watermark: model=opus-5.5; effort=high; duration=12m; seat=claude-code; date=2026-10-18 */
import { describe, expect, it } from "vite-plus/test";

import {
  buildRaceEntrantFeed,
  buildRaceFileMatrix,
  combineEntrantChanges,
  formatRaceDuration,
  raceEntrantElapsedMs,
  raceJudgePhase,
  splitUnifiedDiff,
} from "./raceArena.logic";

// Real `git diff` output shapes: a modification, an untracked file diffed
// against /dev/null, a rename with edits, a deletion and a binary file.
const MODIFIED = [
  "diff --git a/src/tally.js b/src/tally.js",
  "index 1111111..2222222 100644",
  "--- a/src/tally.js",
  "+++ b/src/tally.js",
  "@@ -1,4 +1,5 @@",
  " export function tally(text) {",
  "-  const counts = {};",
  "+  const counts = Object.create(null);",
  "+  // lower-case first",
  '   for (const word of text.split(" ")) {',
  "--- a/not-a-header",
].join("\n");

const ADDED = [
  "diff --git a/test/tally.test.js b/test/tally.test.js",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/test/tally.test.js",
  "@@ -0,0 +1,2 @@",
  '+import { test } from "node:test";',
  '+test("counts", () => {});',
].join("\n");

const RENAMED = [
  "diff --git a/lib/old.js b/lib/new.js",
  "similarity index 90%",
  "rename from lib/old.js",
  "rename to lib/new.js",
  "index 4444444..5555555 100644",
  "--- a/lib/old.js",
  "+++ b/lib/new.js",
  "@@ -1 +1 @@",
  "-export const a = 1;",
  "+export const a = 2;",
].join("\n");

const DELETED = [
  "diff --git a/README.old b/README.old",
  "deleted file mode 100644",
  "index 6666666..0000000",
  "--- a/README.old",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-# old",
  "-gone",
].join("\n");

const BINARY = [
  "diff --git a/logo.png b/logo.png",
  "index 7777777..8888888 100644",
  "Binary files a/logo.png and b/logo.png differ",
].join("\n");

describe("splitUnifiedDiff", () => {
  it("returns one entry per file with its own patch and line counts", () => {
    const files = splitUnifiedDiff([MODIFIED, ADDED, RENAMED, DELETED, BINARY].join("\n"));
    expect(files.map((file) => [file.path, file.change, file.additions, file.deletions])).toEqual([
      // A deleted line that happens to start with "--- " still counts as a deletion.
      ["src/tally.js", "modified", 2, 2],
      ["test/tally.test.js", "added", 2, 0],
      ["lib/new.js", "renamed", 1, 1],
      ["README.old", "deleted", 0, 2],
      ["logo.png", "modified", 0, 0],
    ]);
    expect(files[2]!.previousPath).toBe("lib/old.js");
    expect(files[4]!.binary).toBe(true);
    expect(files[1]!.patch.startsWith("diff --git a/test/tally.test.js")).toBe(true);
    expect(files[1]!.patch).not.toContain("lib/old.js");
  });

  it("treats empty or whitespace diffs as no files", () => {
    expect(splitUnifiedDiff("")).toEqual([]);
    expect(splitUnifiedDiff("\n  \n")).toEqual([]);
  });
});

describe("combineEntrantChanges", () => {
  it("merges committed and uncommitted work, keeping both patches for a shared file", () => {
    const committed = MODIFIED;
    const uncommitted = [
      "diff --git a/src/tally.js b/src/tally.js",
      "--- a/src/tally.js",
      "+++ b/src/tally.js",
      "@@ -9 +9,2 @@",
      "+// tie-break",
      "+// alphabetically",
      ADDED,
    ].join("\n");
    const changes = combineEntrantChanges({ committed, uncommitted, truncated: false });
    expect(changes.files.map((file) => file.path)).toEqual(["src/tally.js", "test/tally.test.js"]);
    const tally = changes.files[0]!;
    expect([tally.additions, tally.deletions, tally.committed, tally.uncommitted]).toEqual([
      4,
      2,
      true,
      true,
    ]);
    expect(tally.patch.match(/^diff --git/gm)).toHaveLength(2);
    expect(changes.files[1]!.committed).toBe(false);
    expect([changes.additions, changes.deletions]).toEqual([6, 2]);
  });

  it("reports an entrant with no work as zero files", () => {
    expect(combineEntrantChanges({ committed: "", uncommitted: null })).toMatchObject({
      files: [],
      additions: 0,
      deletions: 0,
      truncated: false,
    });
  });
});

describe("buildRaceFileMatrix", () => {
  const file = (path: string, additions: number, deletions = 0) => ({
    path,
    previousPath: null,
    change: "modified" as const,
    additions,
    deletions,
    binary: false,
    patch: "",
  });

  it("puts files every entrant touched first, then by size, and counts unique files", () => {
    const matrix = buildRaceFileMatrix([
      [file("src/a.js", 3), file("src/only-one.js", 50), file("README.md", 1)],
      [file("src/a.js", 10, 2), file("README.md", 4)],
      [file("src/a.js", 1), file("test/c.js", 5)],
    ]);
    expect(matrix.rows.map((row) => [row.path, row.touchedBy])).toEqual([
      ["src/a.js", 3],
      ["README.md", 2],
      ["src/only-one.js", 1],
      ["test/c.js", 1],
    ]);
    expect(matrix.rows[0]!.cells.map((cell) => cell?.additions ?? null)).toEqual([3, 10, 1]);
    expect(matrix.rows[1]!.cells[2]).toBeNull();
    expect(matrix.sharedCount).toBe(1);
    expect(matrix.uniqueCounts).toEqual([1, 0, 1]);
  });

  it("does not call a file shared when only one entrant has changes yet", () => {
    const matrix = buildRaceFileMatrix([[file("src/a.js", 1)], null]);
    expect(matrix.sharedCount).toBe(0);
    expect(matrix.uniqueCounts).toEqual([1, 0]);
  });
});

describe("timing", () => {
  it("measures a running turn against now and a finished one against completion", () => {
    const turn = {
      requestedAt: "2026-10-18T10:00:00.000Z",
      startedAt: "2026-10-18T10:00:02.000Z",
      completedAt: null,
    };
    const now = Date.parse("2026-10-18T10:01:07.000Z");
    expect(raceEntrantElapsedMs(turn, now)).toBe(65_000);
    expect(raceEntrantElapsedMs({ ...turn, completedAt: "2026-10-18T10:00:32.000Z" }, now)).toBe(
      30_000,
    );
    expect(raceEntrantElapsedMs(null, now)).toBeNull();
  });

  it("formats durations the way a stopwatch reads", () => {
    expect(formatRaceDuration(null)).toBe("—");
    expect(formatRaceDuration(9_400)).toBe("9s");
    expect(formatRaceDuration(65_000)).toBe("1m 05s");
    expect(formatRaceDuration(3_780_000)).toBe("1h 03m");
  });
});

describe("buildRaceEntrantFeed", () => {
  const message = (id: string, role: "user" | "assistant", text: string, createdAt: string) => ({
    id,
    role,
    text,
    streaming: false,
    createdAt,
  });

  it("drops the shared prompt, interleaves work by time and keeps the latest items", () => {
    const feed = buildRaceEntrantFeed({
      messages: [
        message("m1", "user", "the race prompt", "2026-10-18T10:00:00.000Z"),
        message("m2", "assistant", "Looking at tally.js", "2026-10-18T10:00:01.000Z"),
        message("m3", "assistant", "Done.", "2026-10-18T10:00:09.000Z"),
      ],
      work: [
        {
          id: "w1",
          createdAt: "2026-10-18T10:00:03.000Z",
          label: "Ran command",
          command: "npm test",
          tone: "tool",
        },
        {
          id: "w2",
          createdAt: "2026-10-18T10:00:05.000Z",
          label: "Edited file",
          detail: "  ",
          tone: "tool",
        },
      ],
      limit: 3,
    });
    expect(feed.hiddenCount).toBe(1);
    expect(feed.items.map((item) => item.id)).toEqual(["w1", "w2", "m3"]);
    expect(feed.items[0]).toMatchObject({ kind: "work", detail: "npm test" });
    expect(feed.items[1]).toMatchObject({ kind: "work", detail: null });
  });
});

describe("raceJudgePhase", () => {
  const base = {
    session: { status: "ready" },
    latestTurn: { state: "completed", completedAt: "2026-10-18T10:00:00.000Z" },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
  };

  it("reads a judge in the project checkout as done without needing a worktree", () => {
    expect(raceJudgePhase(base)).toBe("done");
  });

  it("follows the session while it works, waits on the user, or fails", () => {
    expect(raceJudgePhase({ ...base, session: { status: "running" } })).toBe("judging");
    expect(raceJudgePhase({ ...base, latestTurn: { state: "running", completedAt: null } })).toBe(
      "judging",
    );
    expect(raceJudgePhase({ ...base, latestTurn: null, session: null })).toBe("starting");
    expect(raceJudgePhase({ ...base, hasPendingApprovals: true })).toBe("attention");
    expect(raceJudgePhase({ ...base, session: { status: "error" } })).toBe("failed");
  });
});
