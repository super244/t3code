/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-03 */
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ComposerStashMenu } from "./ComposerStashMenu";

vi.mock("./ComposerBanner", async () => {
  const { createElement } = await import("react");
  const wrapper = ({ children, render, ...props }: Record<string, unknown>) =>
    createElement(
      (render as { type?: string } | undefined)?.type ?? "div",
      props,
      children as never,
    );
  return {
    ComposerBanner: Object.fromEntries(
      [
        "Root",
        "Row",
        "Scroll",
        "Children",
        "Icon",
        "Content",
        "Actions",
        "Dismiss",
        "ToggleIcon",
      ].map((name) => [name, wrapper]),
    ),
  };
});

class Target {
  constructor(readonly kind: "search" | "button" | "other") {}
  closest(selector: string) {
    return (selector === "[data-prompt-library-search]" && this.kind === "search") ||
      (selector === "button" && this.kind === "button")
      ? this
      : null;
  }
  isContentEditable = false;
}
const entries = ["Review the database", "Audit the mobile composer"].map((prompt, index) => ({
  id: String(index),
  prompt,
  createdAt: new Date(0).toISOString(),
  attachments: [],
  droppedImageNames: [],
}));
let renderer: ReactTestRenderer;
let keydown: (event: KeyboardEvent) => void;
const onRestore = vi.fn();
const onDelete = vi.fn();
function press(key: string, kind: "search" | "button" | "other", overrides = {}) {
  const event = {
    key,
    target: new Target(kind),
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  };
  act(() => keydown(event as unknown as KeyboardEvent));
  return event;
}
function search(value: string) {
  act(() => renderer.root.findByType("input").props.onChange({ target: { value } }));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("HTMLElement", Target);
  vi.stubGlobal("Element", Target);
  vi.stubGlobal("document", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    activeElement: null,
  });
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: typeof keydown) => {
      if (type === "keydown") keydown = listener;
    },
    removeEventListener: vi.fn(),
  });
  act(() => {
    renderer = create(
      <ComposerStashMenu
        entries={entries}
        stashShortcutLabel={null}
        onRestore={onRestore}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    );
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  vi.unstubAllGlobals();
});
describe("prompt library interactions", () => {
  it("restores only the matching saved prompt and navigates within results", () => {
    search("mobile audit");
    press("ArrowDown", "search");
    press("Enter", "search");
    expect(onRestore).toHaveBeenCalledWith(entries[1]);
  });
  it("does not restore hidden prompts for an empty result", () => {
    search("unmatched");
    press("Enter", "search");
    expect(onRestore).not.toHaveBeenCalled();
  });
  it("leaves text deletion and composition in the search field alone", () => {
    expect(press("Backspace", "search", { ctrlKey: true }).preventDefault).not.toHaveBeenCalled();
    press("Enter", "search", { isComposing: true });
    expect(onDelete).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
  });
  it("filters presets before restoring them", () => {
    act(() =>
      renderer.root
        .findAllByType("button")
        .find((button) => button.props["data-stash-tab"] === "presets")!
        .props.onClick(),
    );
    search("unmatched-preset");
    press("Enter", "search");
    expect(onRestore).not.toHaveBeenCalled();
    search("refactor");
    press("Enter", "search");
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore.mock.calls[0]?.[0].id).toMatch(/^preset-/);
  });
  it("keeps deletion bound to the visible saved prompt", () => {
    search("mobile");
    press("Backspace", "other", { metaKey: true });
    expect(onDelete).toHaveBeenCalledWith(entries[1]);
  });
  it("does not hijack Enter on a button in the presets tab", () => {
    act(() =>
      renderer.root
        .findAllByType("button")
        .find((button) => button.props["data-stash-tab"] === "presets")!
        .props.onClick(),
    );
    expect(press("Enter", "button").preventDefault).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
  });
});
