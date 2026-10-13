/* agent-watermark: model=haiku-5.5; effort=high; duration=45m; seat=claude-code; date=2026-10-12 */
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { Kbd } from "../ui/kbd";
import {
  buildDiffChangesTree,
  type DiffChangeEntry,
  type DiffChangeStatus,
  type DiffChangesRow,
  flattenDiffChangesTree,
  summarizeDiffChanges,
} from "./diffChangesTree.logic";

const STATUS_LETTER: Record<DiffChangeStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

const STATUS_CLASS: Record<DiffChangeStatus, string> = {
  added: "text-success",
  modified: "text-warning",
  deleted: "text-destructive",
  renamed: "text-info",
};

const STATUS_TITLE: Record<DiffChangeStatus, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
};

const formatCount = (value: number) => value.toLocaleString();

interface DiffChangesTreeProps {
  readonly entries: ReadonlyArray<DiffChangeEntry>;
  /** The file the diff is focused on. Its row is highlighted and scrolled into view. */
  readonly selectedPath: string | null;
  readonly isViewed: (entry: DiffChangeEntry) => boolean;
  readonly onSelectFile: (path: string) => void;
  readonly onToggleViewed: (entry: DiffChangeEntry, viewed: boolean) => void;
  readonly ariaLabel: string;
  readonly className?: string;
}

const DirectoryRow = memo(function DirectoryRow(props: {
  readonly row: Extract<DiffChangesRow, { kind: "directory" }>;
  readonly onToggle: (path: string) => void;
}) {
  const { row, onToggle } = props;
  const Chevron = row.expanded ? ChevronDownIcon : ChevronRightIcon;
  return (
    <li>
      <button
        type="button"
        aria-expanded={row.expanded}
        className="flex w-full min-w-0 items-center gap-1 rounded-md py-1 pe-3 text-start text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        style={{ paddingInlineStart: 8 + row.depth * 12 }}
        onClick={() => onToggle(row.path)}
      >
        <Chevron aria-hidden="true" className="size-3 shrink-0 opacity-70" />
        <span className="min-w-0 truncate">{row.label}</span>
      </button>
    </li>
  );
});

const FileRow = memo(function FileRow(props: {
  readonly row: Extract<DiffChangesRow, { kind: "file" }>;
  readonly selected: boolean;
  readonly viewed: boolean;
  readonly onSelectFile: (path: string) => void;
  readonly onToggleViewed: (entry: DiffChangeEntry, viewed: boolean) => void;
}) {
  const { row, selected, viewed, onSelectFile, onToggleViewed } = props;
  const { entry } = row;
  const renamedFrom = entry.previousPath
    ? entry.previousPath.slice(entry.previousPath.lastIndexOf("/") + 1)
    : null;
  return (
    <li className="flex items-center gap-1 pe-2">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-start text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
          viewed && !selected && "text-muted-foreground",
        )}
        style={{ paddingInlineStart: 8 + row.depth * 12 }}
        onClick={() => onSelectFile(entry.path)}
      >
        <span
          className={cn(
            "w-3 shrink-0 text-center font-mono text-[11px] font-semibold",
            STATUS_CLASS[entry.status],
          )}
        >
          {STATUS_LETTER[entry.status]}
          <span className="sr-only">{STATUS_TITLE[entry.status]}</span>
        </span>
        <span className={cn("flex min-w-0 flex-1 items-baseline gap-1.5", viewed && "opacity-70")}>
          <span className="min-w-0 truncate">{row.label}</span>
          {renamedFrom !== null && (
            <span className="min-w-0 truncate text-[10px] text-muted-foreground/80">
              from {renamedFrom}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] tabular-nums">
          {entry.additions > 0 && (
            <span className="text-success">+{formatCount(entry.additions)}</span>
          )}
          {entry.deletions > 0 && (
            <span className="text-destructive">−{formatCount(entry.deletions)}</span>
          )}
        </span>
      </button>
      <button
        type="button"
        aria-pressed={viewed}
        aria-label={viewed ? `Viewed: ${entry.path}` : `Mark viewed: ${entry.path}`}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          viewed ? "bg-success/15 text-success" : "text-muted-foreground/50 hover:text-foreground",
        )}
        onClick={() => onToggleViewed(entry, !viewed)}
      >
        {viewed ? (
          <CheckIcon aria-hidden="true" className="size-3" />
        ) : (
          <span aria-hidden="true" className="size-2.5 rounded-full border border-current" />
        )}
      </button>
    </li>
  );
});

/**
 * The changed files of one diff as a folder tree, with per-file status and line counts, a
 * viewed mark per file, and a summary above the list. The diff panel owns the keys; the hints
 * below name them.
 */
export function DiffChangesTree({
  entries,
  selectedPath,
  isViewed,
  onSelectFile,
  onToggleViewed,
  ariaLabel,
  className,
}: DiffChangesTreeProps) {
  const nodes = useMemo(() => buildDiffChangesTree(entries), [entries]);
  const [collapsedDirectories, setCollapsedDirectories] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const rows = useMemo(
    () => flattenDiffChangesTree(nodes, collapsedDirectories),
    [nodes, collapsedDirectories],
  );
  const viewedKeys = useMemo(
    () => new Set(entries.filter((entry) => isViewed(entry)).map((entry) => entry.key)),
    [entries, isViewed],
  );
  const summary = useMemo(() => summarizeDiffChanges(entries, viewedKeys), [entries, viewedKeys]);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (selectedPath === null) return;
    listRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selectedPath]);

  const toggleDirectory = useCallback((path: string) => {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col bg-background", className)}>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 px-3 text-xs">
        <span className="font-medium text-foreground">
          {formatCount(summary.fileCount)} {summary.fileCount === 1 ? "file" : "files"}
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
          <span className="text-success">+{formatCount(summary.additions)}</span>
          <span className="text-destructive">−{formatCount(summary.deletions)}</span>
        </span>
        <span className="ms-auto tabular-nums text-muted-foreground">
          {formatCount(summary.viewedCount)}/{formatCount(summary.fileCount)} viewed
        </span>
      </div>
      <ul aria-label={ariaLabel} ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {rows.map((row) =>
          row.kind === "directory" ? (
            <DirectoryRow key={row.key} row={row} onToggle={toggleDirectory} />
          ) : (
            <FileRow
              key={row.key}
              row={row}
              selected={row.entry.path === selectedPath}
              viewed={viewedKeys.has(row.entry.key)}
              onSelectFile={onSelectFile}
              onToggleViewed={onToggleViewed}
            />
          ),
        )}
      </ul>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd>
          <span>files</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>]</Kbd>
          <Kbd>[</Kbd>
          <span>hunks</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>V</Kbd>
          <span>viewed</span>
        </span>
      </div>
    </div>
  );
}
