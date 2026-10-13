/* agent-watermark: model=haiku-5.5; effort=high; duration=27m; seat=claude-code; date=2026-10-12 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildRootGroups,
  commandPaletteNoMatchCopy,
  filterCommandPaletteGroups,
  orderByRecentKeys,
  readRecentCommandKeys,
  recordRecentCommandKey,
  RECENT_COMMANDS_STORAGE_KEY,
  shortcutKeycapTokens,
  type CommandPaletteActionItem,
} from "./CommandPalette.logic";

function action(value: string): CommandPaletteActionItem {
  return {
    kind: "action",
    value,
    searchTerms: [value],
    title: value,
    icon: null,
    run: async () => {},
  };
}

/** A minimal in-memory window.localStorage so the palette's recency store can run under node. */
function stubLocalStorage(failWrites = false) {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrites) throw new Error("QuotaExceededError");
        store.set(key, value);
      },
    },
  });
  return store;
}

describe("recently run commands", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records the most recent command first and moves a repeat to the front", () => {
    stubLocalStorage();
    recordRecentCommandKey("open:usage");
    recordRecentCommandKey("open:race");
    expect(recordRecentCommandKey("open:usage")).toEqual(["open:usage", "open:race"]);
    expect(readRecentCommandKeys()).toEqual(["open:usage", "open:race"]);
  });

  it("persists per viewer under its own storage key", () => {
    const store = stubLocalStorage();
    recordRecentCommandKey("open:usage");
    expect(JSON.parse(store.get(RECENT_COMMANDS_STORAGE_KEY) ?? "null")).toEqual(["open:usage"]);
  });

  it("caps the history so it cannot grow without bound", () => {
    stubLocalStorage();
    let keys: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      keys = recordRecentCommandKey(`command:${index}`);
    }
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe("command:29");
  });

  it("reads nothing when storage is absent, corrupt or not a list", () => {
    expect(readRecentCommandKeys()).toEqual([]);
    const store = stubLocalStorage();
    store.set(RECENT_COMMANDS_STORAGE_KEY, "{not json");
    expect(readRecentCommandKeys()).toEqual([]);
    store.set(RECENT_COMMANDS_STORAGE_KEY, JSON.stringify({ value: 1 }));
    expect(readRecentCommandKeys()).toEqual([]);
  });

  it("keeps working in memory when storage writes are blocked", () => {
    stubLocalStorage(true);
    expect(recordRecentCommandKey("open:usage")).toEqual(["open:usage"]);
  });
});

describe("recent-first ordering", () => {
  it("floats recent keys to the front and keeps everything else in its original order", () => {
    const items = ["a", "b", "c", "d"].map(action);
    const ordered = orderByRecentKeys(items, ["c", "a", "not-listed"], (item) => item.value);
    expect(ordered.map((item) => item.value)).toEqual(["c", "a", "b", "d"]);
  });

  it("returns the original order when there is no history", () => {
    const items = ["a", "b"].map(action);
    expect(orderByRecentKeys(items, [], (item) => item.value).map((item) => item.value)).toEqual([
      "a",
      "b",
    ]);
  });

  it("puts recently run root actions first in the Actions group", () => {
    const groups = buildRootGroups({
      actionItems: ["open:command-center", "open:usage", "open:race"].map(action),
      recentThreadItems: [],
      recentCommandKeys: ["open:race", "open:usage"],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "open:race",
      "open:usage",
      "open:command-center",
    ]);
  });

  it("keeps the static order when no recent keys are passed", () => {
    const groups = buildRootGroups({
      actionItems: ["x", "y"].map(action),
      recentThreadItems: [],
    });
    expect(groups[0]?.items.map((item) => item.value)).toEqual(["x", "y"]);
  });
});

describe("shortcutKeycapTokens", () => {
  it("splits mac glyph runs into one keycap per modifier and the key", () => {
    expect(shortcutKeycapTokens("⇧⌘O")).toEqual(["⇧", "⌘", "O"]);
    expect(shortcutKeycapTokens("⌘P")).toEqual(["⌘", "P"]);
  });

  it("splits joined labels on plus signs", () => {
    expect(shortcutKeycapTokens("Ctrl+Shift+O")).toEqual(["Ctrl", "Shift", "O"]);
  });

  it("keeps a multi-character key as one keycap", () => {
    expect(shortcutKeycapTokens("⌘Enter")).toEqual(["⌘", "Enter"]);
  });

  it("returns nothing for an empty label", () => {
    expect(shortcutKeycapTokens("   ")).toEqual([]);
  });
});

describe("commandPaletteNoMatchCopy", () => {
  it("names the searched term and suggests what to try", () => {
    expect(commandPaletteNoMatchCopy({ query: "zzqxw", isActionsOnly: false })).toEqual({
      title: "Nothing matches “zzqxw”.",
      hint: "Try a command, a project name, or part of a thread title.",
    });
  });

  it("strips the actions prefix from the quoted term", () => {
    expect(commandPaletteNoMatchCopy({ query: ">usage", isActionsOnly: true }).title).toBe(
      "No actions match “usage”.",
    );
  });

  it("falls back to a generic line for an empty query", () => {
    expect(commandPaletteNoMatchCopy({ query: "  ", isActionsOnly: false }).title).toBe(
      "No matching commands, projects, or threads.",
    );
  });
});

describe("palette search over titles", () => {
  it("finds an action by its plain title even when its curated terms omit the title words", () => {
    const race: CommandPaletteActionItem = {
      ...action("action:race"),
      title: "Open Race",
      searchTerms: ["race", "compare"],
    };
    const groups = filterCommandPaletteGroups({
      activeGroups: [{ value: "actions", label: "Actions", items: [race, action("action:usage")] }],
      query: "open race",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });
    expect(groups.flatMap((group) => group.items.map((item) => item.value))).toEqual([
      "action:race",
    ]);
  });
});
