/* agent-watermark: model=haiku-5.5; effort=high; duration=45m; seat=claude-code; date=2026-10-12 */
import { describe, expect, it } from "vite-plus/test";

import { getRenderablePatch } from "~/lib/diffRendering";

import { WORKING_TREE_DEMO_PATCH } from "./__fixtures__/workingTreeDemoPatch";

import {
  buildDiffChangeEntries,
  buildDiffChangesTree,
  buildDiffHunkAnchors,
  type DiffChangeEntry,
  type DiffChangesTreeNode,
  diffViewedStorageKey,
  flattenDiffChangesTree,
  isDiffEntryViewed,
  parseDiffViewedRecord,
  stepDiffFile,
  stepDiffHunk,
  summarizeDiffChanges,
  withDiffEntryViewed,
} from "./diffChangesTree.logic";

// A real `git diff HEAD` of a scratch repo: a rename, a deletion, two new files, and several
// modified files, with the hunk shapes git produces. The totals below are the same numbers the
// diff panel header shows for that repo (+62 -37).
const DEMO_PATCH = WORKING_TREE_DEMO_PATCH;

function demoFiles() {
  const result = getRenderablePatch(DEMO_PATCH, "diff-changes-tree-test");
  if (result?.kind !== "files") throw new Error("fixture did not parse into files");
  return result.files;
}

function demoEntries(): ReadonlyArray<DiffChangeEntry> {
  return buildDiffChangeEntries(demoFiles());
}

describe("buildDiffChangeEntries", () => {
  it("reads each changed file's status, path, and line counts from the real patch", () => {
    const entries = demoEntries();
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));

    expect(entries).toHaveLength(8);
    expect(byPath.get("docs/OVERVIEW.md")).toMatchObject({
      status: "renamed",
      previousPath: "docs/README.md",
      additions: 1,
      deletions: 0,
    });
    expect(byPath.get("src/server/routes/sessions.ts")).toMatchObject({
      status: "deleted",
      previousPath: null,
      additions: 0,
      deletions: 9,
    });
    expect(byPath.get("src/features/billing/tax.ts")?.status).toBe("added");
    expect(byPath.get("src/components/Toolbar.tsx")?.status).toBe("modified");
  });

  it("sums to the same totals the diff header shows for this patch", () => {
    const entries = demoEntries();
    const summary = summarizeDiffChanges(entries, new Set());

    expect(summary.fileCount).toBe(8);
    expect(summary.additions).toBe(62);
    expect(summary.deletions).toBe(37);
    expect(summary.viewedCount).toBe(0);
  });

  it("gives every file a key that matches the code view item it scrolls to", () => {
    const entries = demoEntries();
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
    expect(entries.find((entry) => entry.path === "docs/OVERVIEW.md")?.key).toBe(
      "docs/README.md\u0000docs/OVERVIEW.md",
    );
  });
});

describe("buildDiffChangesTree", () => {
  it("lists folders before files at each level and joins single-child folder chains", () => {
    const tree = buildDiffChangesTree(demoEntries());
    const names = (nodes: ReadonlyArray<DiffChangesTreeNode>) =>
      nodes.map((node) => `${node.kind}:${node.name}`);

    expect(names(tree)).toEqual(["directory:docs", "directory:src"]);
    const src = tree[1];
    expect(src?.kind).toBe("directory");
    if (src?.kind !== "directory") return;
    expect(names(src.children)).toEqual([
      "directory:components",
      "directory:features/billing",
      "directory:lib",
      "directory:server/routes",
      "file:app.ts",
    ]);
  });

  it("flattens to rows and hides the contents of collapsed folders", () => {
    const tree = buildDiffChangesTree(demoEntries());
    const open = flattenDiffChangesTree(tree, new Set());
    const collapsed = flattenDiffChangesTree(tree, new Set(["src/lib"]));

    expect(open.filter((row) => row.kind === "file")).toHaveLength(8);
    expect(collapsed.filter((row) => row.kind === "file")).toHaveLength(8 - 2);
    const libRow = collapsed.find((row) => row.kind === "directory" && row.path === "src/lib");
    expect(libRow).toMatchObject({ kind: "directory", expanded: false, depth: 1 });
  });
});

describe("file navigation", () => {
  const entries = demoEntries();
  const paths = entries.map((entry) => entry.path);

  it("steps through files in list order and stops at the ends", () => {
    expect(stepDiffFile(entries, null, 1)?.path).toBe(paths[0]);
    expect(stepDiffFile(entries, null, -1)?.path).toBe(paths.at(-1));
    expect(stepDiffFile(entries, paths[0]!, 1)?.path).toBe(paths[1]);
    expect(stepDiffFile(entries, paths[0]!, -1)?.path).toBe(paths[0]);
    expect(stepDiffFile(entries, paths.at(-1)!, 1)?.path).toBe(paths.at(-1));
  });

  it("starts from the first file when the focused path is no longer in the diff", () => {
    expect(stepDiffFile(entries, "src/gone.ts", 1)?.path).toBe(paths[0]);
    expect(stepDiffFile([], null, 1)).toBeNull();
  });
});

describe("hunk navigation", () => {
  it("has one anchor per hunk of the real patch, on the side that has the first line", () => {
    const files = demoFiles();
    const anchors = buildDiffHunkAnchors(files);
    const hunkHeaders = DEMO_PATCH.split("\n").filter((line) => line.startsWith("@@")).length;

    expect(anchors).toHaveLength(hunkHeaders);
    const app = anchors.find((anchor) => anchor.filePath === "src/app.ts");
    expect(app).toMatchObject({ side: "additions", lineNumber: 1 });
    const deletedFile = anchors.find(
      (anchor) => anchor.filePath === "src/server/routes/sessions.ts",
    );
    expect(deletedFile).toMatchObject({ side: "deletions" });
    expect(anchors.every((anchor) => anchor.lineNumber >= 1)).toBe(true);
  });

  it("moves between hunks and clamps at both ends, starting from no hunk", () => {
    expect(stepDiffHunk(3, -1, 1)).toBe(0);
    expect(stepDiffHunk(3, -1, -1)).toBe(2);
    expect(stepDiffHunk(3, 0, -1)).toBe(0);
    expect(stepDiffHunk(3, 2, 1)).toBe(2);
    expect(stepDiffHunk(3, 1, 1)).toBe(2);
    expect(stepDiffHunk(0, -1, 1)).toBe(-1);
  });
});

describe("viewed marks", () => {
  const entries = demoEntries();
  const app = entries.find((entry) => entry.path === "src/app.ts")!;

  it("keys the stored record per thread", () => {
    expect(diffViewedStorageKey("env-1", "thread-9")).toBe("t3code.diffViewed.v1:env-1:thread-9");
  });

  it("reads a stored record defensively", () => {
    expect(parseDiffViewedRecord(null)).toEqual({});
    expect(parseDiffViewedRecord("{not json")).toEqual({});
    expect(parseDiffViewedRecord("[1,2]")).toEqual({});
    expect(parseDiffViewedRecord('{"src/app.ts":5,"bad":"x","nan":null}')).toEqual({
      "src/app.ts": 5,
    });
  });

  it("counts a file as viewed only while it still has the version it was viewed at", () => {
    const viewed = withDiffEntryViewed({}, entries, app, true);
    expect(isDiffEntryViewed(viewed, app)).toBe(true);

    const edited: DiffChangeEntry = { ...app, version: app.version + 1 };
    expect(isDiffEntryViewed(viewed, edited)).toBe(false);
  });

  it("drops marks for files that left the diff and unmarks on request", () => {
    const stale = { "src/gone.ts": 1, "src/app.ts": app.version };
    const cleaned = withDiffEntryViewed(stale, entries, app, false);
    expect(cleaned).toEqual({});
    const marked = withDiffEntryViewed(stale, entries, app, true);
    expect(marked).toEqual({ "src/app.ts": app.version });
  });

  it("does not treat inherited object keys as marks", () => {
    expect(isDiffEntryViewed({}, { ...app, path: "constructor" })).toBe(false);
  });
});
