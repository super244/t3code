/* agent-watermark: model=haiku-5.5; effort=high; duration=45m; seat=claude-code; date=2026-10-12 */
import type { FileDiffMetadata } from "@pierre/diffs";

import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  getSingleFileDiffLineStat,
  resolveFileDiffPath,
  resolveFileDiffPreviousPath,
} from "~/lib/diffRendering";

export type DiffChangeStatus = "added" | "modified" | "deleted" | "renamed";

/** One changed file as the diff panel's file list and navigation see it. */
export interface DiffChangeEntry {
  /** The code view's item id for this file, so a tree row can scroll the diff to it. */
  readonly key: string;
  readonly path: string;
  /** Set only for a rename: the path the file had before the change. */
  readonly previousPath: string | null;
  readonly status: DiffChangeStatus;
  readonly additions: number;
  readonly deletions: number;
  /**
   * Changes whenever the file's diff changes. A file marked viewed at one version is
   * unviewed again once the agent or the user edits it further.
   */
  readonly version: number;
}

export function diffChangeStatus(file: FileDiffMetadata): DiffChangeStatus {
  switch (file.type) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
    case "rename-changed":
      return "renamed";
    case "change":
      return "modified";
  }
}

export function buildDiffChangeEntries(
  files: ReadonlyArray<FileDiffMetadata>,
): ReadonlyArray<DiffChangeEntry> {
  return files.map((file) => {
    const path = resolveFileDiffPath(file);
    const previousPath = resolveFileDiffPreviousPath(file);
    const stat = getSingleFileDiffLineStat(file);
    return {
      key: buildFileDiffIdentityKey(file),
      path,
      previousPath: previousPath !== path ? previousPath : null,
      status: diffChangeStatus(file),
      additions: stat.additions,
      deletions: stat.deletions,
      version: buildFileDiffContentVersion(file),
    };
  });
}

export interface DiffChangesSummary {
  readonly fileCount: number;
  readonly additions: number;
  readonly deletions: number;
  readonly viewedCount: number;
}

export function summarizeDiffChanges(
  entries: ReadonlyArray<DiffChangeEntry>,
  viewedKeys: ReadonlySet<string>,
): DiffChangesSummary {
  let additions = 0;
  let deletions = 0;
  let viewedCount = 0;
  for (const entry of entries) {
    additions += entry.additions;
    deletions += entry.deletions;
    if (viewedKeys.has(entry.key)) viewedCount += 1;
  }
  return { fileCount: entries.length, additions, deletions, viewedCount };
}

export interface DiffChangesDirectoryNode {
  readonly kind: "directory";
  /** One or more path segments; single-child folder chains are joined with "/". */
  readonly name: string;
  /** Full folder path without a trailing slash, unique within the tree. */
  readonly path: string;
  readonly children: ReadonlyArray<DiffChangesTreeNode>;
}

export interface DiffChangesFileNode {
  readonly kind: "file";
  readonly name: string;
  readonly entry: DiffChangeEntry;
}

export type DiffChangesTreeNode = DiffChangesDirectoryNode | DiffChangesFileNode;

interface MutableDirectory {
  readonly name: string;
  readonly path: string;
  readonly directories: Map<string, MutableDirectory>;
  readonly files: DiffChangeEntry[];
}

const compareNames = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

function freezeDirectory(directory: MutableDirectory): DiffChangesTreeNode[] {
  const directories = [...directory.directories.values()]
    .toSorted((left, right) => compareNames(left.name, right.name))
    .map((child): DiffChangesTreeNode => {
      // A folder whose only child is another folder reads as one row, like a path.
      let folder = child;
      while (folder.files.length === 0 && folder.directories.size === 1) {
        const [only] = folder.directories.values();
        if (!only) break;
        folder = { ...only, name: `${folder.name}/${only.name}` };
      }
      return {
        kind: "directory",
        name: folder.name,
        path: folder.path,
        children: freezeDirectory(folder),
      };
    });
  const files = directory.files
    .toSorted((left, right) => compareNames(left.path, right.path))
    .map((entry): DiffChangesTreeNode => ({
      kind: "file",
      name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
      entry,
    }));
  return [...directories, ...files];
}

/**
 * The changed files as a folder tree. Folders come before files at each level, both sorted
 * the way the diff's own file list is, and a chain of single-child folders collapses into one
 * row.
 */
export function buildDiffChangesTree(
  entries: ReadonlyArray<DiffChangeEntry>,
): ReadonlyArray<DiffChangesTreeNode> {
  const root: MutableDirectory = { name: "", path: "", directories: new Map(), files: [] };
  for (const entry of entries) {
    const segments = entry.path.split("/");
    let directory = root;
    let folderPath = "";
    for (const segment of segments.slice(0, -1)) {
      folderPath = folderPath ? `${folderPath}/${segment}` : segment;
      let child = directory.directories.get(segment);
      if (!child) {
        child = { name: segment, path: folderPath, directories: new Map(), files: [] };
        directory.directories.set(segment, child);
      }
      directory = child;
    }
    directory.files.push(entry);
  }
  return freezeDirectory(root);
}

export type DiffChangesRow =
  | {
      readonly kind: "directory";
      readonly key: string;
      readonly path: string;
      readonly label: string;
      readonly depth: number;
      readonly expanded: boolean;
    }
  | {
      readonly kind: "file";
      readonly key: string;
      readonly label: string;
      readonly depth: number;
      readonly entry: DiffChangeEntry;
    };

/** The rows a tree shows, in order, skipping the contents of collapsed folders. */
export function flattenDiffChangesTree(
  nodes: ReadonlyArray<DiffChangesTreeNode>,
  collapsedDirectories: ReadonlySet<string>,
): ReadonlyArray<DiffChangesRow> {
  const rows: DiffChangesRow[] = [];
  const visit = (children: ReadonlyArray<DiffChangesTreeNode>, depth: number) => {
    for (const node of children) {
      if (node.kind === "file") {
        rows.push({
          kind: "file",
          key: node.entry.key,
          label: node.name,
          depth,
          entry: node.entry,
        });
        continue;
      }
      const expanded = !collapsedDirectories.has(node.path);
      rows.push({
        kind: "directory",
        key: `dir:${node.path}`,
        path: node.path,
        label: node.name,
        depth,
        expanded,
      });
      if (expanded) visit(node.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return rows;
}

/** The next file to focus, clamped to the ends of the list. From nothing, step 1 is the first file. */
export function stepDiffFile(
  entries: ReadonlyArray<DiffChangeEntry>,
  currentPath: string | null,
  step: 1 | -1,
): DiffChangeEntry | null {
  if (entries.length === 0) return null;
  const index =
    currentPath === null ? -1 : entries.findIndex((entry) => entry.path === currentPath);
  if (index < 0) return step > 0 ? entries[0]! : entries[entries.length - 1]!;
  return entries[Math.min(entries.length - 1, Math.max(0, index + step))]!;
}

/** Where a hunk navigation lands: the first line of the hunk, on the side that has it. */
export interface DiffHunkAnchor {
  readonly fileKey: string;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly side: "additions" | "deletions";
}

export function buildDiffHunkAnchors(
  files: ReadonlyArray<FileDiffMetadata>,
): ReadonlyArray<DiffHunkAnchor> {
  const anchors: DiffHunkAnchor[] = [];
  for (const file of files) {
    const fileKey = buildFileDiffIdentityKey(file);
    const filePath = resolveFileDiffPath(file);
    for (const hunk of file.hunks) {
      const hasAdditions = hunk.additionLines > 0;
      anchors.push({
        fileKey,
        filePath,
        lineNumber: Math.max(1, hasAdditions ? hunk.additionStart : hunk.deletionStart),
        side: hasAdditions ? "additions" : "deletions",
      });
    }
  }
  return anchors;
}

/** The next hunk index. From no hunk yet, step 1 is the first hunk and step -1 the last. */
export function stepDiffHunk(count: number, current: number, step: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0 || current >= count) return step > 0 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + step));
}

/** Viewed marks: file path to the content version the reader last marked viewed. */
export type DiffViewedRecord = Readonly<Record<string, number>>;

export function diffViewedStorageKey(environmentId: string, threadId: string): string {
  return `t3code.diffViewed.v1:${environmentId}:${threadId}`;
}

export function parseDiffViewedRecord(raw: string | null): DiffViewedRecord {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const record: Record<string, number> = {};
    for (const [path, version] of Object.entries(parsed)) {
      if (typeof version === "number" && Number.isFinite(version)) record[path] = version;
    }
    return record;
  } catch {
    return {};
  }
}

export function isDiffEntryViewed(record: DiffViewedRecord, entry: DiffChangeEntry): boolean {
  return Object.hasOwn(record, entry.path) && record[entry.path] === entry.version;
}

/**
 * The record after one file's viewed state changes. Paths that are no longer in the diff are
 * dropped, so the stored record stays the size of the diff it describes.
 */
export function withDiffEntryViewed(
  record: DiffViewedRecord,
  entries: ReadonlyArray<DiffChangeEntry>,
  entry: DiffChangeEntry,
  viewed: boolean,
): DiffViewedRecord {
  const next: Record<string, number> = {};
  const livePaths = new Set(entries.map((candidate) => candidate.path));
  for (const [path, version] of Object.entries(record)) {
    if (livePaths.has(path)) next[path] = version;
  }
  if (viewed) {
    next[entry.path] = entry.version;
  } else {
    delete next[entry.path];
  }
  return next;
}
