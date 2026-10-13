/* agent-watermark: model=haiku-5.5; effort=high; duration=25m; seat=claude-code; date=2026-10-13 */
/* agent-watermark: model=haiku-5.5; effort=high; duration=45m; seat=claude-code; date=2026-10-12 */
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getRenderablePatch } from "~/lib/diffRendering";

import { WORKING_TREE_DEMO_PATCH } from "./__fixtures__/workingTreeDemoPatch";

import { DiffChangesTree } from "./DiffChangesTree";
import {
  buildDiffChangeEntries,
  type DiffChangeEntry,
  diffViewedStorageKey,
} from "./diffChangesTree.logic";
import { useDiffViewedFiles } from "./useDiffViewedFiles";

const DEMO_PATCH = WORKING_TREE_DEMO_PATCH;
const STORAGE_KEY = diffViewedStorageKey("env-demo", "thread-demo", "branch");
const APP_PATH = "src/app.ts";

function demoEntries(): DiffChangeEntry[] {
  const result = getRenderablePatch(DEMO_PATCH, "diff-changes-tree-component-test");
  if (result?.kind !== "files") throw new Error("fixture did not parse into files");
  return [...buildDiffChangeEntries(result.files)];
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  } as Storage;
}

// The diff panel's wiring in miniature: the tree, with viewed marks read from and written to
// the thread's stored record.
function Panel({
  entries,
  storageKey = STORAGE_KEY,
}: {
  entries: DiffChangeEntry[];
  storageKey?: string | null;
}) {
  const { isViewed, setViewed } = useDiffViewedFiles(storageKey);
  return (
    <DiffChangesTree
      entries={entries}
      selectedPath={null}
      isViewed={isViewed}
      onSelectFile={() => undefined}
      onToggleViewed={(entry, viewed) => setViewed(entries, entry, viewed)}
      ariaLabel="Working tree files"
    />
  );
}

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textOf((node as { children: unknown }).children);
  }
  return "";
}

describe("DiffChangesTree viewed marks", () => {
  let renderer: ReactTestRenderer | undefined;
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  function mount(element: ReactNode) {
    act(() => {
      renderer = create(<>{element}</>);
    });
    return renderer!;
  }

  function markButton(path: string) {
    const button = renderer!.root.findAll(
      (node) =>
        node.type === "button" &&
        (node.props["aria-label"] === `Mark viewed: ${path}` ||
          node.props["aria-label"] === `Viewed: ${path}`),
    )[0];
    if (!button) throw new Error(`no viewed control for ${path}`);
    return button;
  }

  function toggle(path: string) {
    const button = markButton(path);
    act(() => {
      button.props.onClick();
    });
  }

  it("marks a file viewed, shows it in the summary, and keeps the mark after a remount", () => {
    const entries = demoEntries();
    mount(<Panel entries={entries} />);
    expect(textOf(renderer!.toJSON())).toContain("0/8 viewed");

    toggle(APP_PATH);
    expect(markButton(APP_PATH).props["aria-pressed"]).toBe(true);
    expect(textOf(renderer!.toJSON())).toContain("1/8 viewed");
    const appEntry = entries.find((entry) => entry.path === APP_PATH)!;
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual({ [APP_PATH]: appEntry.version });

    act(() => {
      renderer!.unmount();
    });
    renderer = undefined;
    mount(<Panel entries={entries} />);
    expect(markButton(APP_PATH).props["aria-pressed"]).toBe(true);
    expect(textOf(renderer!.toJSON())).toContain("1/8 viewed");
  });

  it("clears the mark when the file's diff changes after it was viewed", () => {
    const entries = demoEntries();
    mount(<Panel entries={entries} />);
    toggle(APP_PATH);

    const edited = entries.map((entry) =>
      entry.path === APP_PATH ? { ...entry, version: entry.version + 1 } : entry,
    );
    act(() => {
      renderer!.update(<Panel entries={edited} />);
    });
    expect(markButton(APP_PATH).props["aria-pressed"]).toBe(false);
    expect(textOf(renderer!.toJSON())).toContain("0/8 viewed");
  });

  it("keeps marks separate per thread", () => {
    const entries = demoEntries();
    mount(<Panel entries={entries} storageKey={STORAGE_KEY} />);
    toggle(APP_PATH);

    act(() => {
      renderer!.unmount();
    });
    renderer = undefined;
    mount(
      <Panel
        entries={entries}
        storageKey={diffViewedStorageKey("env-demo", "other-thread", "branch")}
      />,
    );
    expect(markButton(APP_PATH).props["aria-pressed"]).toBe(false);
  });

  it("still renders and marks in-session when browser storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {
        throw new Error("storage blocked");
      },
    });
    const entries = demoEntries();
    mount(<Panel entries={entries} />);
    toggle(APP_PATH);
    expect(markButton(APP_PATH).props["aria-pressed"]).toBe(true);
    expect(textOf(renderer!.toJSON())).toContain("1/8 viewed");
  });
});
