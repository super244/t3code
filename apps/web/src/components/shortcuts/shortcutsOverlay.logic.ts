import type { KeybindingCommand } from "@t3tools/contracts";

/** Dispatched on `window` to open the overlay from anywhere (palette, menus). */
export const OPEN_SHORTCUTS_EVENT = "t3:open-shortcuts";

export interface ShortcutEntry {
  readonly command: KeybindingCommand;
  readonly label: string;
  /** Every effective shortcut for the command, in config order, deduplicated. */
  readonly keys: ReadonlyArray<string>;
  /** Human condition, e.g. "in terminal"; null when the binding is global. */
  readonly context: string | null;
  readonly custom: boolean;
}

export interface ShortcutGroup {
  readonly id: string;
  readonly title: string;
  readonly entries: ReadonlyArray<ShortcutEntry>;
}

const GROUPS: ReadonlyArray<{ id: string; title: string; prefixes: ReadonlyArray<string> }> = [
  {
    id: "general",
    title: "General",
    prefixes: ["commandPalette", "filePicker", "projectSearch", "sidebar", "themeEditor", "editor"],
  },
  { id: "threads", title: "Threads", prefixes: ["chat", "thread", "composer", "modelPicker"] },
  { id: "panels", title: "Panels & diff", prefixes: ["rightPanel", "diff", "preview"] },
  { id: "terminal", title: "Terminal", prefixes: ["terminal"] },
  { id: "scripts", title: "Project scripts", prefixes: ["script"] },
];

/** Jump-to-N commands collapse into one row each ("Jump to thread 1–9"). */
const COLLAPSIBLE = [
  { pattern: /^thread\.jump\.(\d+)$/, command: "thread.jump", label: "Jump to thread 1–9" },
  {
    pattern: /^modelPicker\.jump\.(\d+)$/,
    command: "modelPicker.jump",
    label: "Pick model 1–9 in the picker",
  },
] as const;

export function shortcutGroupFor(command: string): string {
  const prefix = command.split(".")[0] ?? command;
  return GROUPS.find((group) => group.prefixes.includes(prefix))?.id ?? "general";
}

/** `terminalFocus && !terminalOpen` → "in terminal" style phrasing; raw text when unknown. */
export function describeWhen(when: string): string | null {
  const trimmed = when.trim();
  if (!trimmed || trimmed === "true") return null;
  const phrases: Record<string, string> = {
    terminalFocus: "in terminal",
    "!terminalFocus": "outside terminal",
    terminalOpen: "terminal open",
    "!terminalOpen": "terminal closed",
    previewFocus: "in preview",
    "!previewFocus": "outside preview",
    modelPickerOpen: "in model picker",
  };
  const humanize = (part: string) => {
    const negated = part.startsWith("!");
    const words = part
      .replace(/^!/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase();
    return negated ? `not ${words}` : words;
  };
  return trimmed
    .split(/\s*&&\s*/)
    .map((part) => phrases[part] ?? humanize(part))
    .join(", ");
}

/** One resolved binding, already labelled and formatted for the current platform. */
export interface ShortcutBindingInput {
  readonly command: KeybindingCommand;
  readonly label: string;
  readonly keyLabel: string;
  readonly when: string;
  readonly custom: boolean;
}

export function buildShortcutGroups(input: {
  readonly bindings: ReadonlyArray<ShortcutBindingInput>;
  readonly query?: string;
}): ReadonlyArray<ShortcutGroup> {
  const byKey = new Map<string, { entry: ShortcutEntry; keys: string[] }>();
  for (const binding of input.bindings) {
    const raw = String(binding.command);
    const collapse = COLLAPSIBLE.find((c) => c.pattern.test(raw));
    const context = describeWhen(binding.when);
    const command = (collapse ? collapse.command : raw) as KeybindingCommand;
    const id = `${command}\u0000${context ?? ""}`;
    const key = binding.keyLabel;
    const existing = byKey.get(id);
    if (existing) {
      if (!collapse && !existing.keys.includes(key)) existing.keys.push(key);
      continue;
    }
    byKey.set(id, {
      entry: {
        command,
        label: collapse ? collapse.label : binding.label,
        keys: [],
        context,
        custom: binding.custom,
      },
      // A jump family shows its modifier once with the digit range.
      keys: [collapse ? `${key.replace(/\d$/, "")}1–9` : key],
    });
  }

  const query = input.query?.trim().toLowerCase() ?? "";
  const entries = [...byKey.values()]
    .map(({ entry, keys }) => ({ ...entry, keys }))
    .filter(
      (entry) =>
        query.length === 0 ||
        entry.label.toLowerCase().includes(query) ||
        String(entry.command).toLowerCase().includes(query) ||
        entry.keys.some((key) => key.toLowerCase().includes(query)) ||
        (entry.context ?? "").includes(query),
    );

  return GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    entries: entries
      .filter((entry) => shortcutGroupFor(String(entry.command)) === group.id)
      .toSorted((left, right) => left.label.localeCompare(right.label)),
  })).filter((group) => group.entries.length > 0);
}

/** `?` opens the sheet only when the user is not typing somewhere. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.closest("[data-keybinding-capture]") !== null
  );
}
