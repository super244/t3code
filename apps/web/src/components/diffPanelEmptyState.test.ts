/* agent-watermark: model=haiku-5.5; effort=high; duration=30m; seat=claude-code; date=2026-10-13 */
import { describe, expect, it } from "vite-plus/test";

import { diffPanelEmptyStateMessage } from "./diffPanelEmptyState";

describe("diffPanelEmptyStateMessage", () => {
  it("does not claim no net changes when the working tree scope is empty but git reports changes", () => {
    const message = diffPanelEmptyStateMessage({
      workingTreeSelected: true,
      statusReportsChanges: true,
    });

    expect(message).toContain("uncommitted changes");
    expect(message).not.toBe("No net changes in this selection.");
  });

  it("keeps the no-net-changes copy when the working tree is genuinely clean", () => {
    expect(
      diffPanelEmptyStateMessage({ workingTreeSelected: true, statusReportsChanges: false }),
    ).toBe("No net changes in this selection.");
  });

  it("keeps the no-net-changes copy while status is still unknown", () => {
    expect(
      diffPanelEmptyStateMessage({ workingTreeSelected: true, statusReportsChanges: undefined }),
    ).toBe("No net changes in this selection.");
  });

  it("keeps the no-net-changes copy for branch scopes even when the working tree is dirty", () => {
    expect(
      diffPanelEmptyStateMessage({ workingTreeSelected: false, statusReportsChanges: true }),
    ).toBe("No net changes in this selection.");
  });
});
