import type { KeybindingCommand } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildShortcutGroups,
  describeWhen,
  type ShortcutBindingInput,
} from "./shortcutsOverlay.logic";

const binding = (
  command: string,
  keyLabel: string,
  when = "",
  custom = false,
): ShortcutBindingInput => ({
  command: command as KeybindingCommand,
  label: command,
  keyLabel,
  when,
  custom,
});

describe("buildShortcutGroups", () => {
  it("collapses a jump family into one row with the digit range", () => {
    const groups = buildShortcutGroups({
      bindings: [1, 2, 3, 9].map((n) => binding(`thread.jump.${n}`, `⌘${n}`)),
    });
    const threads = groups.find((group) => group.id === "threads");
    expect(threads?.entries).toHaveLength(1);
    expect(threads?.entries[0]?.keys).toEqual(["⌘1–9"]);
  });

  it("keeps every key of a command and separates contexts", () => {
    const groups = buildShortcutGroups({
      bindings: [
        binding("chat.new", "⌘N", "!terminalFocus"),
        binding("chat.new", "⇧⌘O", "!terminalFocus"),
        binding("terminal.close", "⌘W", "terminalFocus"),
        binding("rightPanel.close", "⌘W", "!terminalFocus", true),
      ],
    });
    const chat = groups.find((g) => g.id === "threads")?.entries[0];
    expect(chat?.keys).toEqual(["⌘N", "⇧⌘O"]);
    expect(chat?.context).toBe("outside terminal");
    expect(groups.find((g) => g.id === "panels")?.entries[0]?.custom).toBe(true);
    expect(groups.map((g) => g.id)).toEqual(["threads", "panels", "terminal"]);
  });

  it("filters by label, command or key", () => {
    const bindings = [binding("sidebar.toggle", "⌘B"), binding("diff.toggle", "⌘D")];
    expect(buildShortcutGroups({ bindings, query: "⌘d" }).flatMap((g) => g.entries)).toHaveLength(
      1,
    );
    expect(buildShortcutGroups({ bindings, query: "nothing" })).toEqual([]);
  });
});

describe("describeWhen", () => {
  it("reads known and unknown conditions", () => {
    expect(describeWhen("true")).toBeNull();
    expect(describeWhen("terminalFocus && terminalOpen")).toBe("in terminal, terminal open");
    expect(describeWhen("!browserFocus")).toBe("not browser focus");
    expect(describeWhen("(terminalOpen || previewFocus)")).toBe("terminal open or in preview");
  });
});
