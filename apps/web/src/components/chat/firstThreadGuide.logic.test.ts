/* agent-watermark: model=haiku-5.5; effort=high; duration=25m; seat=claude-code; date=2026-10-13 */
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";

import { FIRST_THREAD_GUIDE_ITEMS, shouldShowFirstThreadGuide } from "./firstThreadGuide.logic";

describe("shouldShowFirstThreadGuide", () => {
  // The bootstrap thread a fresh install gets from the server's cwd, as the
  // shell snapshot reports it: created, never used.
  const bootstrapThread = { latestUserMessageAt: null };
  const usedThread = { latestUserMessageAt: "2026-10-13T09:12:44.000Z" };

  it("waits for the shell snapshot before claiming nothing was sent", () => {
    expect(shouldShowFirstThreadGuide({ bootstrapped: false, threads: [] })).toBe(false);
    expect(shouldShowFirstThreadGuide({ bootstrapped: false, threads: [bootstrapThread] })).toBe(
      false,
    );
  });

  it("shows on a fresh install that holds only the untouched bootstrap thread", () => {
    expect(shouldShowFirstThreadGuide({ bootstrapped: true, threads: [] })).toBe(true);
    expect(shouldShowFirstThreadGuide({ bootstrapped: true, threads: [bootstrapThread] })).toBe(
      true,
    );
  });

  it("stops teaching once any thread has a user message", () => {
    expect(shouldShowFirstThreadGuide({ bootstrapped: true, threads: [usedThread] })).toBe(false);
    expect(
      shouldShowFirstThreadGuide({ bootstrapped: true, threads: [bootstrapThread, usedThread] }),
    ).toBe(false);
  });
});

describe("FIRST_THREAD_GUIDE_ITEMS", () => {
  it("covers the composer, the model picker, and the launchpad, in that order", () => {
    expect(FIRST_THREAD_GUIDE_ITEMS.map((item) => item.id)).toEqual([
      "composer",
      "model",
      "launchpad",
    ]);
  });

  it("only names shortcuts that exist in the default keybinding table", () => {
    // A keycap for a command with no binding would render nothing, so every
    // shortcut the guide names has to be a real default rule.
    for (const item of FIRST_THREAD_GUIDE_ITEMS) {
      if (item.shortcut === null) continue;
      expect(DEFAULT_KEYBINDINGS.some((rule) => rule.command === item.shortcut)).toBe(true);
    }
  });
});
