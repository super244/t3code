/* agent-watermark: model=opus-5.5; effort=high; duration=25m; seat=claude-code; date=2026-10-12 */
import { describe, expect, it } from "vitest";

import { describeNightlyVersion } from "./nightlyStatus";

describe("describeNightlyVersion", () => {
  it("reads a nightly version as its date and build", () => {
    expect(describeNightlyVersion("0.0.46-nightly.20261012.3021")).toMatch(/Oct 12 · build 3021$/);
  });

  it("leaves anything that is not a nightly version as written", () => {
    expect(describeNightlyVersion("0.0.46-preview.20261010.2909")).toBe(
      "0.0.46-preview.20261010.2909",
    );
    expect(describeNightlyVersion("0.0.40")).toBe("0.0.40");
  });
});
