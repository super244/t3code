/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-03 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Preferences } from "../../persistence/mobile-preferences";
const fixture = vi.hoisted(() => ({
  snapshot: {} as Preferences,
  stored: {} as Preferences,
  save: vi.fn(),
  pending: null as Promise<void> | null,
  failure: false,
}));
vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: "preferences",
  updateMobilePreferencesAtom: "patch",
  transformMobilePreferencesCommand: "transform",
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => crypto.randomUUID() }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => AsyncResult.success(fixture.snapshot),
  useAtomSet: () => fixture.save,
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => async (transform: (current: Preferences) => Partial<Preferences>) =>
    AsyncResult.success(await fixture.save(transform)),
}));
import { useMobilePromptStash } from "./useMobilePromptStash";
function capture() {
  let result!: ReturnType<typeof useMobilePromptStash>;
  function Consumer() {
    // oxlint-disable-next-line react/globals -- Local test capture; no UI or external state is mutated.
    result = useMobilePromptStash();
    return null;
  }
  renderToStaticMarkup(createElement(Consumer));
  return result;
}
beforeEach(() => {
  fixture.snapshot = {};
  fixture.stored = {};
  fixture.pending = null;
  fixture.failure = false;
  fixture.save
    .mockReset()
    .mockImplementation(
      (input: Partial<Preferences> | ((current: Preferences) => Partial<Preferences>)) => {
        const commit = () => {
          if (fixture.failure) throw new Error("Storage failed");
          const patch = typeof input === "function" ? input(fixture.stored) : input;
          fixture.stored = { ...fixture.stored, ...patch };
          return fixture.stored;
        };
        return fixture.pending ? fixture.pending.then(commit) : Promise.resolve(commit());
      },
    );
});
describe("mobile prompt stash persistence", () => {
  it("retains consecutive saves from the same rendered snapshot", async () => {
    const stash = capture();
    await stash.stashPrompt("First prompt");
    await stash.stashPrompt("Second prompt");
    expect(fixture.stored.stashedPrompts?.map((entry) => entry.prompt)).toEqual([
      "Second prompt",
      "First prompt",
    ]);
  });
  it("deletes against current storage rather than resurrecting an older snapshot", async () => {
    const initial = { id: "old", prompt: "Old", createdAt: "2026-10-03T00:00:00Z" };
    fixture.snapshot = fixture.stored = { stashedPrompts: [initial] };
    const stash = capture();
    await stash.stashPrompt("New");
    await stash.deleteStash("old");
    expect(fixture.stored.stashedPrompts?.map((entry) => entry.prompt)).toEqual(["New"]);
  });
  it("does not acknowledge a stash before the storage write settles", async () => {
    let complete!: () => void;
    fixture.pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const stash = capture();
    let acknowledged = false;
    const saving = stash.stashPrompt("Keep this draft").then((saved) => {
      acknowledged = saved;
    });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    expect(fixture.stored.stashedPrompts).toBeUndefined();
    complete();
    await saving;
    expect(acknowledged).toBe(true);
    expect(fixture.stored.stashedPrompts?.[0]?.prompt).toBe("Keep this draft");
  });
  it("reports a failed save and does not erase existing prompts", async () => {
    fixture.stored = {
      stashedPrompts: [{ id: "old", prompt: "Keep", createdAt: "2026-10-03T00:00:00Z" }],
    };
    fixture.failure = true;
    await expect(capture().stashPrompt("New")).rejects.toThrow("Storage failed");
    expect(fixture.stored.stashedPrompts?.[0]?.prompt).toBe("Keep");
  });
  it("deduplicates trimmed prompts while enforcing the library limit", async () => {
    fixture.stored = {
      stashedPrompts: Array.from({ length: 30 }, (_, index) => ({
        id: String(index),
        prompt: `Prompt ${index}`,
        createdAt: "2026-10-03T00:00:00Z",
      })),
    };
    const stash = capture();
    await stash.stashPrompt("  Prompt 0  ", "   ");
    expect(fixture.stored.stashedPrompts).toHaveLength(30);
    expect(
      fixture.stored.stashedPrompts?.filter((entry) => entry.prompt === "Prompt 0"),
    ).toHaveLength(1);
    expect(fixture.stored.stashedPrompts?.[0]?.title).toBeUndefined();
    await stash.stashPrompt("Newest");
    expect(fixture.stored.stashedPrompts).toHaveLength(30);
    expect(fixture.stored.stashedPrompts?.at(-1)?.prompt).toBe("Prompt 28");
    expect(await stash.stashPrompt("   ")).toBe(false);
  });
});
