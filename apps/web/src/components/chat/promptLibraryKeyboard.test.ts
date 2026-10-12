/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-03 */
import { describe, expect, it } from "vite-plus/test";
import { promptLibraryKeyAction } from "./promptLibraryKeyboard";
const key = {
  key: "Enter",
  isComposing: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target: "other" as const,
};
describe("prompt library keyboard actions", () => {
  it("lets tab, category, close and delete buttons handle Enter normally", () => {
    expect(promptLibraryKeyAction({ ...key, target: "button" })).toBeNull();
    expect(promptLibraryKeyAction({ ...key, target: "search" })).toBe("restore");
  });
  it("does not delete a saved prompt when editing the search input", () => {
    expect(
      promptLibraryKeyAction({ ...key, key: "Backspace", ctrlKey: true, target: "search" }),
    ).toBeNull();
    expect(promptLibraryKeyAction({ ...key, key: "Backspace", metaKey: true })).toBe("delete");
  });
  it("preserves composition and unrelated editing shortcuts", () => {
    expect(promptLibraryKeyAction({ ...key, isComposing: true })).toBeNull();
    expect(promptLibraryKeyAction({ ...key, key: "Escape", isComposing: true })).toBeNull();
    expect(promptLibraryKeyAction({ ...key, key: "ArrowUp", ctrlKey: true })).toBeNull();
    expect(promptLibraryKeyAction({ ...key, key: "ArrowDown", target: "editable" })).toBeNull();
  });
  it("keeps unmodified menu navigation and Escape available", () => {
    expect(promptLibraryKeyAction({ ...key, key: "ArrowDown", target: "search" })).toBe("next");
    expect(promptLibraryKeyAction({ ...key, key: "ArrowUp" })).toBe("previous");
    expect(promptLibraryKeyAction({ ...key, key: "Escape", target: "button" })).toBe("close");
  });
});
