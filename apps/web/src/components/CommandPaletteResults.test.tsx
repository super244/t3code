/* agent-watermark: model=haiku-5.5; effort=high; duration=27m; seat=claude-code; date=2026-10-12 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";

import { buildRootGroups, type CommandPaletteActionItem } from "./CommandPalette.logic";
import { CommandPaletteResults } from "./CommandPaletteResults";
import { Command } from "./ui/command";

function action(value: string, title: string): CommandPaletteActionItem {
  return {
    kind: "action",
    value,
    searchTerms: [title],
    title,
    icon: null,
    run: async () => {},
  };
}

const keybindings = [] satisfies ResolvedKeybindingsConfig;

// Results render inside the Command root, as they do in the palette.
function renderResults(groups: Parameters<typeof CommandPaletteResults>[0]["groups"], query = "") {
  return renderToStaticMarkup(
    <Command>
      <CommandPaletteResults
        groups={groups}
        isActionsOnly={false}
        keybindings={keybindings}
        onExecuteItem={() => {}}
        query={query}
      />
    </Command>,
  );
}

function titleOrder(markup: string, titles: readonly string[]): string[] {
  return [...titles]
    .map((title) => ({ title, index: markup.indexOf(`>${title}<`) }))
    .filter((entry) => entry.index >= 0)
    .toSorted((left, right) => left.index - right.index)
    .map((entry) => entry.title);
}

describe("CommandPaletteResults recent-first ordering", () => {
  it("renders the recently run command above the static order", () => {
    const groups = buildRootGroups({
      actionItems: [
        action("open:command-center", "Open Command Center"),
        action("open:usage", "Open Usage"),
        action("open:race", "Open Race"),
      ],
      recentThreadItems: [],
      recentCommandKeys: ["open:race"],
    });

    const markup = renderResults(groups);

    expect(titleOrder(markup, ["Open Command Center", "Open Usage", "Open Race"])).toEqual([
      "Open Race",
      "Open Command Center",
      "Open Usage",
    ]);
    expect(markup).toContain("Actions");
  });

  it("names the searched term in the no-match line", () => {
    const markup = renderResults([], "zzqxw");
    expect(markup).toContain("Nothing matches");
    expect(markup).toContain("zzqxw");
    expect(markup).toContain("Try a command");
  });
});
