/* agent-watermark: model=haiku-5.5; effort=high; duration=30m; seat=claude-code; date=2026-10-13 */

/**
 * Empty-diff copy for the diff panel. The working-tree scope is often picked
 * because git status reports uncommitted changes, so an empty diff under it
 * must not claim "no net changes" while that status still stands.
 */
export function diffPanelEmptyStateMessage(input: {
  readonly workingTreeSelected: boolean;
  readonly statusReportsChanges: boolean | undefined;
}): string {
  if (input.workingTreeSelected && input.statusReportsChanges === true) {
    return "Git reports uncommitted changes here, but the working tree diff came back empty.";
  }
  return "No net changes in this selection.";
}
