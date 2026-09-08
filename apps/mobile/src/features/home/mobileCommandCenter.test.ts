import { describe, expect, it } from "vite-plus/test";

import { buildMobileCommandCenterSummary } from "./mobileCommandCenter";

describe("buildMobileCommandCenterSummary", () => {
  it("starts empty when no environment snapshot is available", () => {
    expect(buildMobileCommandCenterSummary([], new Map())).toEqual({
      active: 0,
      attention: 0,
      readyProviders: 0,
      totalProviders: 0,
      routines: 0,
    });
  });
});
