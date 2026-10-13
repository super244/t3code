/* agent-watermark: model=haiku-5.5; effort=high; duration=28m; seat=claude-code; date=2026-10-12 */
import { act, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";

import { WorkGroupToggle } from "./WorkGroupToggle";

function ExpandableRun(props: { failedCount: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <WorkGroupToggle
      summary="Ran 4 commands, read 2 files, and changed 2 files"
      icon={<span>tool-icon</span>}
      expanded={expanded}
      failedCount={props.failedCount}
      onToggle={() => setExpanded((previous) => !previous)}
    />
  );
}

function renderRun(failedCount: number): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<ExpandableRun failedCount={failedCount} />);
  });
  if (!renderer) throw new Error("run did not render");
  return renderer;
}

function summaryButton(renderer: ReactTestRenderer) {
  return renderer.root.findByType("button");
}

describe("WorkGroupToggle", () => {
  it("opens and closes the per-call rows from the summary line", () => {
    const renderer = renderRun(0);
    expect(summaryButton(renderer).props["aria-expanded"]).toBe(false);

    act(() => summaryButton(renderer).props.onClick());
    expect(summaryButton(renderer).props["aria-expanded"]).toBe(true);

    act(() => summaryButton(renderer).props.onClick());
    expect(summaryButton(renderer).props["aria-expanded"]).toBe(false);
  });

  it("reports failed calls as a status beside the summary and in its label", () => {
    const renderer = renderRun(2);
    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain("2 failed");
    expect(summaryButton(renderer).props["aria-label"]).toBe(
      "Ran 4 commands, read 2 files, and changed 2 files, 2 failed",
    );
  });

  it("shows no failure status when every call in the run succeeded", () => {
    const renderer = renderRun(0);

    expect(JSON.stringify(renderer.toJSON())).not.toContain("failed");
    expect(summaryButton(renderer).props["aria-label"]).toBeUndefined();
  });
});
