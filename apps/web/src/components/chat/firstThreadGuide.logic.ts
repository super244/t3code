/* agent-watermark: model=haiku-5.5; effort=high; duration=25m; seat=claude-code; date=2026-10-13 */
import type { KeybindingCommand } from "@t3tools/contracts";

export interface FirstThreadGuideItem {
  readonly id: "composer" | "model" | "launchpad";
  readonly title: string;
  readonly body: string;
  /** One line for phones, where the three notes must fit above the composer. */
  readonly compactBody: string;
  /** Keybinding command whose current shortcut label is shown as a keycap, if any. */
  readonly shortcut: KeybindingCommand | null;
}

/** The three things worth knowing on the first draft. Static copy, no tour. */
export const FIRST_THREAD_GUIDE_ITEMS: ReadonlyArray<FirstThreadGuideItem> = [
  {
    id: "composer",
    title: "Describe the task",
    body: "Write what you want done and send it. Shift+Enter starts a new line.",
    compactBody: "Write it out, then send.",
    shortcut: null,
  },
  {
    id: "model",
    title: "Choose a model",
    body: "Pick the model for this thread from the composer before you send.",
    compactBody: "Pick it in the composer.",
    shortcut: "modelPicker.toggle",
  },
  {
    id: "launchpad",
    title: "Launchpad",
    body: "Every project and recent thread on one screen.",
    compactBody: "Every project and recent thread.",
    shortcut: "launchpad.open",
  },
];

/**
 * Shown until the user has sent a message anywhere in the workspace. A fresh
 * install already holds one empty thread (the server's cwd bootstrap), so
 * "no threads" would hide the guide on exactly the screen it is for. Waits
 * for the shell snapshot, because an empty list before bootstrap means "not
 * loaded", not "nothing sent yet".
 */
export function shouldShowFirstThreadGuide(input: {
  readonly bootstrapped: boolean;
  readonly threads: ReadonlyArray<{ readonly latestUserMessageAt: string | null }>;
}): boolean {
  return input.bootstrapped && input.threads.every((thread) => thread.latestUserMessageAt === null);
}
