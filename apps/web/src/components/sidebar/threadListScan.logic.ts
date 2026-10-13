/* agent-watermark: model=haiku-5.5; effort=high; duration=30m; seat=claude-code; date=2026-10-12 */
import type { SidebarThreadStatus } from "../Sidebar.logic";

/**
 * Pure logic for the sidebar's scan affordances: project groups with counts,
 * the honest empty-search message, row stepping, and which keys belong to the
 * list. Kept free of React so every rule has an executing test.
 */

export interface ProjectScanGroup<TThread> {
  readonly projectKey: string;
  readonly threads: readonly TThread[];
  /** Threads whose real session is running a turn. */
  readonly workingCount: number;
  /** Threads waiting on the user: an approval or a question. */
  readonly awaitingCount: number;
}

/**
 * Groups threads by project while keeping the input order. Groups appear in
 * the order their first thread appears, so the most recent thread's project
 * leads, and rows inside a group keep their existing sort.
 */
export function groupThreadsByProject<TThread>(
  threads: readonly TThread[],
  input: {
    readonly projectKeyOf: (thread: TThread) => string;
    readonly statusOf: (thread: TThread) => SidebarThreadStatus;
  },
): ProjectScanGroup<TThread>[] {
  const groups = new Map<
    string,
    { threads: TThread[]; workingCount: number; awaitingCount: number }
  >();
  for (const thread of threads) {
    const projectKey = input.projectKeyOf(thread);
    let group = groups.get(projectKey);
    if (group === undefined) {
      group = { threads: [], workingCount: 0, awaitingCount: 0 };
      groups.set(projectKey, group);
    }
    group.threads.push(thread);
    const status = input.statusOf(thread);
    if (status === "working") group.workingCount += 1;
    if (status === "approval" || status === "input") group.awaitingCount += 1;
  }
  return [...groups].map(([projectKey, group]) => ({
    projectKey,
    threads: group.threads,
    workingCount: group.workingCount,
    awaitingCount: group.awaitingCount,
  }));
}

/** The status words a group header shows, or null when there is nothing live to say. */
export function projectGroupStatusLabels(input: {
  readonly workingCount: number;
  readonly awaitingCount: number;
}): string[] {
  const labels: string[] = [];
  if (input.workingCount > 0) labels.push(`${input.workingCount} working`);
  if (input.awaitingCount > 0) labels.push(`${input.awaitingCount} waiting`);
  return labels;
}

/**
 * The empty-search line. Says what was searched for and never invents a
 * result count; null when there is no query or something matched.
 */
export function scanEmptyMessage(input: { readonly query: string; readonly matchCount: number }) {
  const query = input.query.trim();
  if (query.length === 0 || input.matchCount > 0) return null;
  return `No threads match “${query}”`;
}

/** Where a search hit can come from, stated plainly under the empty line. */
export const SCAN_SEARCH_SCOPE_HINT =
  "Searches thread titles and linked pull request numbers and titles.";

/**
 * Steps a roving row index by one, clamped at both ends (no wrap, so the last
 * row stays put). An index outside the list starts from the matching edge.
 * Returns -1 for an empty list.
 */
export function nextScanIndex(current: number, length: number, delta: 1 | -1): number {
  if (length <= 0) return -1;
  if (current < 0 || current >= length) return delta === 1 ? 0 : length - 1;
  return Math.min(length - 1, Math.max(0, current + delta));
}

/** The subset of a DOM event target the key rules read. */
export interface ScanKeyTarget {
  readonly tagName?: string | undefined;
  readonly isContentEditable?: boolean | undefined;
  readonly closest?: ((selector: string) => unknown) | undefined;
}

const EDITABLE_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  ".cm-editor",
  ".ProseMirror",
  "[data-lexical-editor]",
].join(", ");

/** True when the key belongs to text entry, so the scan keys must not take it. */
export function isEditableScanTarget(target: ScanKeyTarget | null | undefined): boolean {
  if (target === null || target === undefined) return false;
  if (target.isContentEditable === true) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return typeof target.closest === "function" && target.closest(EDITABLE_TARGET_SELECTOR) != null;
}

export type ScanKeyAction =
  | { readonly type: "focus-search" }
  | { readonly type: "move"; readonly delta: 1 | -1 }
  | { readonly type: "none" };

/**
 * Routes a keydown for the sidebar scan. "/" focuses the search box from
 * anywhere that is not a text field. j and the arrows move between rows only
 * while a row already holds focus, so the keys never fire from the composer or
 * from an unrelated page. Modified keys are left alone.
 */
export function resolveScanKey(input: {
  readonly key: string;
  readonly hasModifier: boolean;
  readonly target: ScanKeyTarget | null | undefined;
  readonly focusOnRow: boolean;
}): ScanKeyAction {
  if (input.hasModifier) return { type: "none" };
  if (isEditableScanTarget(input.target)) return { type: "none" };
  if (input.key === "/") return { type: "focus-search" };
  if (!input.focusOnRow) return { type: "none" };
  if (input.key === "j" || input.key === "ArrowDown") return { type: "move", delta: 1 };
  if (input.key === "k" || input.key === "ArrowUp") return { type: "move", delta: -1 };
  return { type: "none" };
}

/** Per-viewer convenience key: whether the active list is grouped by project. */
export const SIDEBAR_GROUP_BY_PROJECT_STORAGE_KEY = "t3code:sidebar-group-active-by-project";

/** Reads the stored preference; anything but the literal "1" means off. */
export function parseGroupByProjectPreference(raw: string | null | undefined): boolean {
  return raw === "1";
}
