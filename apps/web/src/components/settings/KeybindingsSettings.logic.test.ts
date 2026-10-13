/* agent-watermark: model=haiku-5.5; effort=high; duration=32m; seat=claude-code; date=2026-10-13 */
import { describe, expect, it } from "vite-plus/test";
import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "@t3tools/shared/keybindings";

import {
  buildAllKeybindingRows,
  buildKeybindingConflictGroups,
  buildKeybindingRows,
  buildKeybindingCommandOptions,
  buildWhenVariableOptions,
  commandLabel,
  filterKeybindingConflictGroups,
  filterKeybindingRows,
  keybindingConflictLabels,
  keybindingFromKeyboardEvent,
  parseWhenExpressionDraft,
  shortcutToKeybindingInput,
  unknownWhenVariables,
  whenAstToExpression,
  whenConditionsCanHoldTogether,
  whenNodeRemoveLabel,
} from "./KeybindingsSettings.logic";

describe("KeybindingsSettings.logic", () => {
  it("builds searchable rows with readable key and when values", () => {
    const rows = buildKeybindingRows(
      [
        {
          command: "terminal.toggle",
          shortcut: {
            key: "j",
            modKey: true,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
          },
          whenAst: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
      ] satisfies ResolvedKeybindingsConfig,
      "terminal",
    );

    expect(rows).toEqual([
      expect.objectContaining({
        command: "terminal.toggle",
        key: "mod+j",
        when: "!terminalFocus",
        defaultKey: "mod+j",
        defaultWhen: "",
        source: "Custom",
      }),
    ]);
  });

  it("captures platform-specific mod shortcuts", () => {
    expect(
      keybindingFromKeyboardEvent(
        { key: "K", code: "KeyK", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        "MacIntel",
      ),
    ).toBe("mod+shift+k");
    expect(
      keybindingFromKeyboardEvent(
        { key: "K", code: "KeyK", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
        "Win32",
      ),
    ).toBe("mod+shift+k");
  });

  it.each([
    ["@", "Digit2", "mod+shift+2"],
    ['"', "Digit2", "mod+shift+2"],
    ["@", "Quote", "mod+shift+'"],
  ])("captures %s at %s by physical key", (key, code, expected) => {
    expect(
      keybindingFromKeyboardEvent(
        {
          key,
          code,
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        },
        "MacIntel",
      ),
    ).toBe(expected);
  });

  it("captures Latin layout keys instead of their punctuation position", () => {
    expect(
      keybindingFromKeyboardEvent(
        {
          key: "m",
          code: "Semicolon",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toBe("mod+m");
  });

  it("serializes shortcuts and when expressions for upserts", () => {
    expect(
      shortcutToKeybindingInput({
        key: " ",
        modKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      }),
    ).toBe("mod+alt+space");

    expect(
      whenAstToExpression({
        type: "and",
        left: { type: "identifier", name: "editorFocus" },
        right: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      }),
    ).toBe("editorFocus && !terminalFocus");

    expect(parseWhenExpressionDraft("editorFocus && (!terminalFocus || modelPickerOpen)")).toEqual({
      ok: true,
      value: {
        type: "and",
        left: { type: "identifier", name: "editorFocus" },
        right: {
          type: "or",
          left: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
          right: { type: "identifier", name: "modelPickerOpen" },
        },
      },
    });
    expect(parseWhenExpressionDraft("editorFocus &&")).toEqual({
      ok: false,
      message: "Use variables with !, &&, ||, and parentheses.",
    });

    expect(parseWhenExpressionDraft("!(terminalFocus || modelPickerOpen)")).toEqual({
      ok: true,
      value: {
        type: "not",
        node: {
          type: "or",
          left: { type: "identifier", name: "terminalFocus" },
          right: { type: "identifier", name: "modelPickerOpen" },
        },
      },
    });
  });

  it("describes the scope of each visual expression removal", () => {
    const condition = { type: "identifier", name: "terminalFocus" } as const;
    const negatedCondition = { type: "not", node: condition } as const;
    const group = { type: "and", left: condition, right: negatedCondition } as const;
    const negatedGroup = { type: "not", node: group } as const;

    expect(whenNodeRemoveLabel(group, 0)).toBe("Clear all conditions");
    expect(whenNodeRemoveLabel(condition, 1)).toBe("Remove condition");
    expect(whenNodeRemoveLabel(negatedCondition, 1)).toBe("Remove condition");
    expect(whenNodeRemoveLabel(group, 1)).toBe("Remove group and its conditions");
    expect(whenNodeRemoveLabel(negatedGroup, 1)).toBe("Remove group and its conditions");
  });

  it("formats static and project script command labels", () => {
    expect(commandLabel("commandPalette.toggle")).toBe("Command Palette: Toggle");
    expect(commandLabel("themeEditor.toggle")).toBe("Theme Editor: Toggle");
    expect(commandLabel("script.setup-db.run")).toBe("Run Script: Setup Db");
  });

  it("builds known when variable options from defaults without frontend labels", () => {
    const options = buildWhenVariableOptions();

    expect(options).toEqual(
      expect.arrayContaining(["terminalFocus", "terminalOpen", "modelPickerOpen", "true", "false"]),
    );
    expect(options).not.toContain("customModeActive");
  });

  it("builds command options from all static commands and resolved project bindings", () => {
    const options = buildKeybindingCommandOptions([
      {
        command: "script.setup-db.run",
        shortcut: {
          key: "r",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
      },
    ] satisfies ResolvedKeybindingsConfig);

    expect(options).toEqual(
      expect.arrayContaining([
        "chat.new",
        "rightPanel.toggleMaximized",
        "thread.stop",
        "script.setup-db.run",
      ]),
    );
    expect(DEFAULT_RESOLVED_KEYBINDINGS.some((binding) => binding.command === "thread.stop")).toBe(
      false,
    );
  });

  it("reports unknown when variables without rejecting parseable expressions", () => {
    const parsed = parseWhenExpressionDraft("!terminalFocus && terminalFoc");

    expect(parsed.ok).toBe(true);
    expect(unknownWhenVariables(parsed.ok ? parsed.value : undefined)).toEqual(["terminalFoc"]);
  });

  it("marks each default shortcut for multi-binding commands as default", () => {
    const rows = buildKeybindingRows(
      [
        {
          command: "chat.new",
          shortcut: {
            key: "n",
            modKey: true,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
          },
          whenAst: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
        {
          command: "chat.new",
          shortcut: {
            key: "o",
            modKey: true,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: true,
          },
          whenAst: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
      ] satisfies ResolvedKeybindingsConfig,
      "",
    );

    expect(rows.map((row) => row.source)).toEqual(["Default", "Default"]);
  });

  it("reports conflicting shortcuts that share an active when context", () => {
    const rows = buildKeybindingRows(
      [
        {
          command: "chat.new",
          shortcut: {
            key: "n",
            modKey: true,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
          },
          whenAst: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
        {
          command: "chat.newLocal",
          shortcut: {
            key: "n",
            modKey: true,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
          },
          whenAst: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
      ] satisfies ResolvedKeybindingsConfig,
      "",
    );

    expect(rows[0]?.conflicts).toEqual(["Chat: New Local"]);
    expect(
      keybindingConflictLabels(rows, {
        rowId: rows[0]?.id ?? "",
        key: "mod+n",
        when: "",
      }),
    ).toEqual(["Chat: New Local"]);
  });
});

describe("KeybindingsSettings.logic conflicts and search", () => {
  // Shapes copied from a real keybindings.json and the shipped defaults. The
  // server drops entries with unknown commands (thread.undo, composer.host and
  // others are not in the command list), so only accepted rules appear here.
  const liveRules = [
    { key: "mod+d", command: "terminal.split", when: "terminalFocus" },
    { key: "mod+d", command: "diff.toggle", when: "!terminalFocus" },
    { key: "mod+w", command: "terminal.close", when: "terminalFocus" },
    { key: "mod+w", command: "rightPanel.close", when: "!terminalFocus" },
    { key: "mod+n", command: "terminal.new", when: "terminalFocus" },
    { key: "mod+n", command: "chat.new", when: "!terminalFocus" },
    { key: "mod+shift+o", command: "chat.new", when: "!terminalFocus" },
    { key: "mod+shift+n", command: "chat.newLocal", when: "!terminalFocus" },
    { key: "mod+shift+h", command: "launchpad.open", when: "!terminalFocus" },
    { key: "mod+1", command: "thread.jump.1" },
    { key: "mod+1", command: "modelPicker.jump.1", when: "modelPickerOpen" },
    { key: "mod+shift+[", command: "thread.previous" },
    { key: "mod+r", command: "preview.refresh", when: "previewFocus" },
    { key: "mod+r", command: "chat.new", when: "terminalFocus" },
  ] as const;
  const liveBindings = compileResolvedKeybindingsConfig([...liveRules]);

  it("keeps a chord apart when its two contexts cannot hold at once", () => {
    const terminalFocus = { type: "identifier", name: "terminalFocus" } as const;
    const notTerminalFocus = { type: "not", node: terminalFocus } as const;
    expect(whenConditionsCanHoldTogether(terminalFocus, notTerminalFocus)).toBe(false);
    expect(whenConditionsCanHoldTogether(undefined, notTerminalFocus)).toBe(true);
    expect(
      whenConditionsCanHoldTogether(
        {
          type: "and",
          left: notTerminalFocus,
          right: { type: "identifier", name: "editableFocus" },
        },
        terminalFocus,
      ),
    ).toBe(false);
    expect(
      whenConditionsCanHoldTogether({ type: "identifier", name: "previewFocus" }, terminalFocus),
    ).toBe(true);
  });

  it("lists only the chords where two bindings can fire on one key press", () => {
    const groups = buildKeybindingConflictGroups(buildAllKeybindingRows(liveBindings));
    expect(groups.map((group) => group.key)).toEqual(["mod+1", "mod+r"]);
    expect(groups[0]?.rows.map((row) => row.command)).toEqual([
      "modelPicker.jump.1",
      "thread.jump.1",
    ]);
    expect(groups[1]?.rows.map((row) => row.command)).toEqual(["chat.new", "preview.refresh"]);
  });

  it("does not report the shared-key pairs split by terminal focus", () => {
    const rows = buildAllKeybindingRows(liveBindings);
    for (const key of ["mod+d", "mod+w", "mod+n", "mod+shift+h"]) {
      expect(rows.filter((row) => row.key === key).every((row) => row.conflicts.length === 0)).toBe(
        true,
      );
    }
  });

  it("keeps a conflict partner visible when the search hides the other side", () => {
    const all = buildAllKeybindingRows(liveBindings);
    const hiddenBySearch = filterKeybindingRows(all, "thread.jump");
    expect(hiddenBySearch.map((row) => row.command)).toEqual(["thread.jump.1"]);
    expect(buildKeybindingConflictGroups(all).map((group) => group.key)).toContain("mod+1");
  });

  it("filters conflict groups by any member and drops groups with no match", () => {
    const groups = buildKeybindingConflictGroups(buildAllKeybindingRows(liveBindings));
    expect(filterKeybindingConflictGroups(groups, "modelpicker").map((group) => group.key)).toEqual(
      ["mod+1"],
    );
    expect(
      filterKeybindingConflictGroups(groups, "modelPicker").map((group) => group.rows.length),
    ).toEqual([1]);
    expect(filterKeybindingConflictGroups(groups, "launchpad")).toEqual([]);
    expect(filterKeybindingConflictGroups(groups, "")).toBe(groups);
  });

  it("finds a binding by its readable label as well as its command id", () => {
    const all = buildAllKeybindingRows(liveBindings);
    expect(filterKeybindingRows(all, "Launchpad: Open").map((row) => row.command)).toEqual([
      "launchpad.open",
    ]);
    expect(filterKeybindingRows(all, "launchpad.open").map((row) => row.key)).toEqual([
      "mod+shift+h",
    ]);
    expect(filterKeybindingRows(all, "   ")).toHaveLength(all.length);
  });

  it("reports the editor's draft against live bindings by context, not by spelling", () => {
    const all = buildAllKeybindingRows(liveBindings);
    expect(
      keybindingConflictLabels(all, { rowId: "new", key: "mod+d", when: "terminalFocus" }),
    ).toEqual(["Terminal: Split"]);
    expect(keybindingConflictLabels(all, { rowId: "new", key: "mod+d", when: "" })).toEqual([
      "Diff: Toggle",
      "Terminal: Split",
    ]);
    expect(
      keybindingConflictLabels(all, { rowId: "new", key: "mod+r", when: "previewFocus" }),
    ).toEqual(["Chat: New", "Preview: Refresh"]);
  });
});
