/* agent-watermark: model=haiku-5.5; effort=high; duration=65m; seat=claude-code; date=2026-10-13 */
/* agent-watermark: model=opus-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-11 */
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
    prefixes: [
      "commandPalette",
      "filePicker",
      "projectSearch",
      "threadSearch",
      "sidebar",
      "themeEditor",
      "editor",
    ],
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

type WhenNode =
  | { kind: "id"; name: string }
  | { kind: "not"; of: WhenNode }
  | { kind: "and" | "or"; of: WhenNode[] };

/** `a && !(b || c)` → a tree; null when the text is not a condition we can read. */
function parseWhen(text: string): WhenNode | null {
  const tokens = text.match(/&&|\|\||!|\(|\)|[A-Za-z_][\w.]*/g) ?? [];
  if (tokens.join("") !== text.replace(/\s+/g, "")) return null;
  let at = 0;
  const list = (kind: "and" | "or", sep: string, next: () => WhenNode | null): WhenNode | null => {
    const parts: WhenNode[] = [];
    for (;;) {
      const part = next();
      if (!part) return null;
      parts.push(part);
      if (tokens[at] !== sep) break;
      at += 1;
    }
    return parts.length === 1 ? parts[0]! : { kind, of: parts };
  };
  const unary = (): WhenNode | null => {
    const token = tokens[at++];
    if (token === "!") {
      const of = unary();
      return of ? { kind: "not", of } : null;
    }
    if (token === "(") {
      const inner = list("or", "||", () => list("and", "&&", unary));
      return tokens[at++] === ")" ? inner : null;
    }
    return token && /^[A-Za-z_]/.test(token) ? { kind: "id", name: token } : null;
  };
  const tree = list("or", "||", () => list("and", "&&", unary));
  return tree && at === tokens.length ? tree : null;
}

/** `terminalFocus && !terminalOpen` → "in terminal, terminal closed"; raw text when unreadable. */
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
  const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  // Precedence survives as parentheses wherever flattening would change the meaning.
  const say = (node: WhenNode, parent: WhenNode["kind"] | null): string => {
    switch (node.kind) {
      case "id":
        return phrases[node.name] ?? words(node.name);
      case "not":
        if (node.of.kind === "id")
          return phrases[`!${node.of.name}`] ?? `not ${words(node.of.name)}`;
        return `not (${say(node.of, null)})`;
      case "and": {
        const text = node.of.map((part) => say(part, "and")).join(", ");
        return parent === "or" ? `(${text})` : text;
      }
      case "or": {
        const text = node.of.map((part) => say(part, "or")).join(" or ");
        return parent === "and" ? `(${text})` : text;
      }
    }
  };
  const tree = parseWhen(trimmed);
  return tree ? say(tree, null) : trimmed;
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
