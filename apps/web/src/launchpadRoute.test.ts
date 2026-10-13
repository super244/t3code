/* agent-watermark: model=haiku-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-12 */
import { assert, describe, it } from "vite-plus/test";

import { createMemoryHistory } from "@tanstack/react-router";

import { getRouter } from "./router";
import { isLaunchpadPath, LAUNCHPAD_PATH } from "./components/launchpadRoute";

describe("launchpad route", () => {
  it("resolves /home to the launchpad route under the chat layout", () => {
    const router = getRouter(createMemoryHistory({ initialEntries: [LAUNCHPAD_PATH] }));
    const matches = router.matchRoutes(LAUNCHPAD_PATH);
    assert.strictEqual(matches.at(-1)?.routeId, "/_chat/home");
  });

  it("keeps / on the draft landing, not the launchpad", () => {
    const router = getRouter(createMemoryHistory({ initialEntries: ["/"] }));
    const matches = router.matchRoutes("/");
    assert.notStrictEqual(matches.at(-1)?.routeId, "/_chat/home");
  });

  it("does not shadow thread routes with the static /home path", () => {
    const router = getRouter(createMemoryHistory({ initialEntries: ["/env-1/thread-1"] }));
    const matches = router.matchRoutes("/env-1/thread-1");
    assert.notStrictEqual(matches.at(-1)?.routeId, "/_chat/home");
  });
});

describe("isLaunchpadPath", () => {
  it("is true for the launchpad address with or without a trailing slash", () => {
    assert.isTrue(isLaunchpadPath("/home"));
    assert.isTrue(isLaunchpadPath("/home/"));
  });

  it("is false for the draft landing, settings, and other threads", () => {
    assert.isFalse(isLaunchpadPath("/"));
    assert.isFalse(isLaunchpadPath("/homepage"));
    assert.isFalse(isLaunchpadPath("/settings/general"));
    assert.isFalse(isLaunchpadPath("/draft/abc"));
  });
});
