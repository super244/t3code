/* agent-watermark: model=haiku-5.5; effort=high; duration=25m; seat=claude-code; date=2026-10-13 */
import {
  STATIC_KEYBINDING_COMMANDS,
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  parseKeybindingWhenExpression,
} from "@t3tools/shared/keybindings";

import { shortcutKeyFromEvent } from "../../keybindings";
import { isMacPlatform } from "../../lib/utils";

export type KeybindingSource = "Default" | "Custom" | "Project";

export interface KeybindingRow {
  readonly id: string;
  readonly command: KeybindingCommand;
  readonly key: string;
  readonly when: string;
  readonly source: KeybindingSource;
  readonly defaultKey: string | null;
  readonly defaultWhen: string;
  readonly binding: ResolvedKeybindingRule;
  readonly conflicts: ReadonlyArray<string>;
}

export type WhenVariableOption = string;
export type KeybindingCommandOption = KeybindingCommand;

const CORE_WHEN_VARIABLES = ["terminalFocus", "terminalOpen", "true", "false"] as const;

const DEFAULT_WHEN_VARIABLES = new Set<string>(CORE_WHEN_VARIABLES);
for (const binding of DEFAULT_RESOLVED_KEYBINDINGS) {
  collectWhenIdentifiersFromNode(binding.whenAst, DEFAULT_WHEN_VARIABLES);
}

export const DEFAULT_WHEN_VARIABLE =
  [...DEFAULT_WHEN_VARIABLES].find(
    (identifier) => identifier !== "true" && identifier !== "false",
  ) ?? "terminalFocus";
const KNOWN_WHEN_VARIABLES = new Set(DEFAULT_WHEN_VARIABLES);

export function shortcutToKeybindingInput(shortcut: KeybindingShortcut): string {
  const parts: string[] = [];
  if (shortcut.modKey) parts.push("mod");
  if (shortcut.metaKey) parts.push("meta");
  if (shortcut.ctrlKey) parts.push("ctrl");
  if (shortcut.altKey) parts.push("alt");
  if (shortcut.shiftKey) parts.push("shift");
  parts.push(shortcut.key === " " ? "space" : shortcut.key === "escape" ? "esc" : shortcut.key);
  return parts.join("+");
}

export function whenAstToExpression(node: KeybindingWhenNode | undefined): string {
  if (!node) return "";
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!${wrapWhenExpression(node.node)}`;
    case "and":
      return `${wrapWhenExpression(node.left)} && ${wrapWhenExpression(node.right)}`;
    case "or":
      return `${wrapWhenExpression(node.left)} || ${wrapWhenExpression(node.right)}`;
  }
}

export function whenNodeRemoveLabel(node: KeybindingWhenNode, depth: number): string {
  if (depth === 0) return "Clear all conditions";
  if (node.type === "identifier" || (node.type === "not" && node.node.type === "identifier")) {
    return "Remove condition";
  }
  return "Remove group and its conditions";
}

function wrapWhenExpression(node: KeybindingWhenNode): string {
  if (node.type === "identifier" || node.type === "not") return whenAstToExpression(node);
  return `(${whenAstToExpression(node)})`;
}

export function parseWhenExpressionDraft(
  expression: string,
): { ok: true; value: KeybindingWhenNode | undefined } | { ok: false; message: string } {
  const trimmed = expression.trim();
  if (trimmed.length === 0) return { ok: true, value: undefined };

  const ast = parseKeybindingWhenExpression(trimmed);
  if (!ast) {
    return {
      ok: false,
      message: "Use variables with !, &&, ||, and parentheses.",
    };
  }

  return { ok: true, value: ast };
}

function sourceForBinding(binding: ResolvedKeybindingRule): KeybindingSource {
  if (String(binding.command).startsWith("script.")) {
    return "Project";
  }

  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);
  const isDefault = DEFAULT_RESOLVED_KEYBINDINGS.some(
    (entry) =>
      entry.command === binding.command &&
      shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
      whenAstToExpression(entry.whenAst) === bindingWhen,
  );

  return isDefault ? "Default" : "Custom";
}

function defaultBindingForBinding(
  binding: ResolvedKeybindingRule,
): ResolvedKeybindingRule | undefined {
  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);

  return (
    DEFAULT_RESOLVED_KEYBINDINGS.find(
      (entry) =>
        entry.command === binding.command &&
        shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
        whenAstToExpression(entry.whenAst) === bindingWhen,
    ) ??
    DEFAULT_RESOLVED_KEYBINDINGS.find(
      (entry) =>
        entry.command === binding.command && whenAstToExpression(entry.whenAst) === bindingWhen,
    ) ??
    DEFAULT_RESOLVED_KEYBINDINGS.find((entry) => entry.command === binding.command)
  );
}

function keybindingRowId(command: KeybindingCommand, key: string, when: string): string {
  return `${command}\u0000${key}\u0000${when}`;
}

/** Above this many distinct conditions the exhaustive check is skipped and overlap is assumed. */
const MAX_EXHAUSTIVE_WHEN_IDENTIFIERS = 16;

function evaluateWhenNode(node: KeybindingWhenNode, values: ReadonlyMap<string, boolean>): boolean {
  switch (node.type) {
    case "identifier":
      if (node.name === "true") return true;
      if (node.name === "false") return false;
      return values.get(node.name) ?? false;
    case "not":
      return !evaluateWhenNode(node.node, values);
    case "and":
      return evaluateWhenNode(node.left, values) && evaluateWhenNode(node.right, values);
    case "or":
      return evaluateWhenNode(node.left, values) || evaluateWhenNode(node.right, values);
  }
}

/**
 * True when some editor context makes both `when` conditions hold at once, so a
 * key pressed in that context would reach either command. An absent condition
 * is always active. The check enumerates the context variables both sides use,
 * which keeps `terminalFocus` and `!terminalFocus` apart while still flagging
 * `previewFocus` against `terminalFocus`, which can both be true.
 */
export function whenConditionsCanHoldTogether(
  left: KeybindingWhenNode | undefined,
  right: KeybindingWhenNode | undefined,
): boolean {
  if (!left || !right) return true;
  const identifiers = new Set<string>();
  collectWhenIdentifiersFromNode(left, identifiers);
  collectWhenIdentifiersFromNode(right, identifiers);
  identifiers.delete("true");
  identifiers.delete("false");
  const names = [...identifiers];
  if (names.length > MAX_EXHAUSTIVE_WHEN_IDENTIFIERS) return true;

  for (let mask = 0; mask < 2 ** names.length; mask += 1) {
    const values = new Map(names.map((name, index) => [name, (mask & (1 << index)) !== 0]));
    if (evaluateWhenNode(left, values) && evaluateWhenNode(right, values)) return true;
  }
  return false;
}

/**
 * True when every context where `narrow` holds is one where `broad` holds too, and the reverse
 * is not so. An absent condition is always active.
 */
function whenConditionNarrows(
  narrow: KeybindingWhenNode | undefined,
  broad: KeybindingWhenNode | undefined,
): boolean {
  if (!broad) return true;
  if (!narrow) return false;
  return !whenConditionsCanHoldTogether(narrow, { type: "not", node: broad });
}

/**
 * Two bindings on one chord where the later one (last match wins at runtime) only applies inside
 * a narrower context than the earlier one. That is an override, so one press still runs one
 * command, and it is not a conflict. The reverse, a broad binding after a narrow one, shadows it
 * everywhere and stays a conflict.
 */
function isIntendedOverride(
  earlier: KeybindingWhenNode | undefined,
  later: KeybindingWhenNode | undefined,
): boolean {
  return whenConditionNarrows(later, earlier) && !whenConditionNarrows(earlier, later);
}

export function keybindingConflictLabels(
  rows: ReadonlyArray<KeybindingRow>,
  input: { readonly rowId: string; readonly key: string; readonly when: string },
): ReadonlyArray<string> {
  if (input.key.trim().length === 0) return [];
  const parsedWhen = parseWhenExpressionDraft(input.when);
  const inputWhenAst = parsedWhen.ok ? parsedWhen.value : undefined;
  const conflicts: Array<string> = [];
  for (const candidate of rows) {
    if (candidate.id === input.rowId || candidate.key !== input.key) continue;
    const overlaps = parsedWhen.ok
      ? whenConditionsCanHoldTogether(candidate.binding.whenAst, inputWhenAst)
      : candidate.when === input.when;
    if (!overlaps) continue;
    // A saved draft lands after the existing rules, so it is the later binding.
    if (parsedWhen.ok && isIntendedOverride(candidate.binding.whenAst, inputWhenAst)) continue;
    conflicts.push(commandLabel(candidate.command));
  }
  return [...new Set(conflicts)].toSorted();
}

/**
 * Each row's conflicts are computed within its own chord, so the work stays linear in chord count.
 * `rows` is in precedence order (the runtime's last match wins), which decides overrides.
 */
function withConflicts(rows: ReadonlyArray<KeybindingRow>): ReadonlyArray<KeybindingRow> {
  const rowsByKey = new Map<
    string,
    Array<{ readonly row: KeybindingRow; readonly index: number }>
  >();
  rows.forEach((row, index) => {
    const group = rowsByKey.get(row.key);
    if (group) group.push({ row, index });
    else rowsByKey.set(row.key, [{ row, index }]);
  });
  return rows.map((row, index) => {
    const group = rowsByKey.get(row.key) ?? [];
    const conflicts = new Set<string>();
    for (const candidate of group) {
      if (candidate.index === index) continue;
      if (!whenConditionsCanHoldTogether(candidate.row.binding.whenAst, row.binding.whenAst)) {
        continue;
      }
      const earlier = candidate.index < index ? candidate.row : row;
      const later = candidate.index < index ? row : candidate.row;
      if (isIntendedOverride(earlier.binding.whenAst, later.binding.whenAst)) continue;
      conflicts.add(commandLabel(candidate.row.command));
    }
    return conflicts.size > 0
      ? Object.assign({}, row, { conflicts: [...conflicts].toSorted() })
      : row;
  });
}

/** Rows whose command, shortcut, condition or source contain the query. Case-insensitive. */
export function filterKeybindingRows(
  rows: ReadonlyArray<KeybindingRow>,
  query: string,
): ReadonlyArray<KeybindingRow> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return rows;
  return rows.filter((row) => {
    return (
      row.command.toLowerCase().includes(normalizedQuery) ||
      commandLabel(row.command).toLowerCase().includes(normalizedQuery) ||
      row.key.toLowerCase().includes(normalizedQuery) ||
      row.when.toLowerCase().includes(normalizedQuery) ||
      row.source.toLowerCase().includes(normalizedQuery)
    );
  });
}

export interface KeybindingConflictGroup {
  /** The shared shortcut in keybinding notation, such as `mod+1`. */
  readonly key: string;
  /** Every binding on this chord that overlaps another one, ordered by command label. */
  readonly rows: ReadonlyArray<KeybindingRow>;
}

/**
 * Chords where at least two bindings can fire on the same key press. Built
 * from the full binding set, so a search that hides one side never hides the
 * conflict itself.
 */
export function buildKeybindingConflictGroups(
  rows: ReadonlyArray<KeybindingRow>,
): ReadonlyArray<KeybindingConflictGroup> {
  const groups = new Map<string, Array<KeybindingRow>>();
  for (const row of rows) {
    if (row.conflicts.length === 0) continue;
    const group = groups.get(row.key);
    if (group) group.push(row);
    else groups.set(row.key, [row]);
  }
  return [...groups]
    .map(([key, groupRows]) => ({
      key,
      rows: groupRows.toSorted((left, right) =>
        commandLabel(left.command).localeCompare(commandLabel(right.command)),
      ),
    }))
    .toSorted((left, right) => left.key.localeCompare(right.key));
}

/** Groups whose rows match the query. A group with no matching row is dropped. */
export function filterKeybindingConflictGroups(
  groups: ReadonlyArray<KeybindingConflictGroup>,
  query: string,
): ReadonlyArray<KeybindingConflictGroup> {
  if (query.trim().length === 0) return groups;
  return groups.flatMap((group) => {
    const rows = filterKeybindingRows(group.rows, query);
    return rows.length > 0 ? [{ key: group.key, rows }] : [];
  });
}

export function buildKeybindingRows(
  keybindings: ResolvedKeybindingsConfig,
  query: string,
): ReadonlyArray<KeybindingRow> {
  return filterKeybindingRows(buildAllKeybindingRows(keybindings), query);
}

/** Every binding with its conflicts, sorted by command then shortcut. Unfiltered. */
export function buildAllKeybindingRows(
  keybindings: ResolvedKeybindingsConfig,
): ReadonlyArray<KeybindingRow> {
  const rows = keybindings.map((binding, index) => {
    const defaultBinding = defaultBindingForBinding(binding);
    const key = shortcutToKeybindingInput(binding.shortcut);
    const when = whenAstToExpression(binding.whenAst);
    return {
      id: `${keybindingRowId(binding.command, key, when)}\u0000${index}`,
      command: binding.command,
      key,
      when,
      source: sourceForBinding(binding),
      defaultKey: defaultBinding ? shortcutToKeybindingInput(defaultBinding.shortcut) : null,
      defaultWhen: whenAstToExpression(defaultBinding?.whenAst),
      binding,
      conflicts: [],
    } satisfies KeybindingRow;
  });

  return withConflicts(rows).toSorted((left, right) => {
    const commandCompare = left.command.localeCompare(right.command);
    if (commandCompare !== 0) return commandCompare;
    return left.key.localeCompare(right.key);
  });
}

function collectWhenIdentifiersFromNode(
  node: KeybindingWhenNode | undefined,
  identifiers: Set<string>,
): void {
  if (!node) return;
  switch (node.type) {
    case "identifier":
      identifiers.add(node.name);
      return;
    case "not":
      collectWhenIdentifiersFromNode(node.node, identifiers);
      return;
    case "and":
    case "or":
      collectWhenIdentifiersFromNode(node.left, identifiers);
      collectWhenIdentifiersFromNode(node.right, identifiers);
      return;
  }
}

export function isKnownWhenVariable(identifier: string): boolean {
  return KNOWN_WHEN_VARIABLES.has(identifier);
}

export function unknownWhenVariables(node: KeybindingWhenNode | undefined): ReadonlyArray<string> {
  const identifiers = new Set<string>();
  collectWhenIdentifiersFromNode(node, identifiers);
  return [...identifiers].filter((identifier) => !isKnownWhenVariable(identifier)).toSorted();
}

export function buildWhenVariableOptions(): ReadonlyArray<WhenVariableOption> {
  return [...KNOWN_WHEN_VARIABLES].toSorted((left, right) => {
    const leftCoreIndex = CORE_WHEN_VARIABLES.indexOf(left as (typeof CORE_WHEN_VARIABLES)[number]);
    const rightCoreIndex = CORE_WHEN_VARIABLES.indexOf(
      right as (typeof CORE_WHEN_VARIABLES)[number],
    );
    if (leftCoreIndex !== -1 || rightCoreIndex !== -1) {
      return (
        (leftCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : leftCoreIndex) -
        (rightCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : rightCoreIndex)
      );
    }
    return left.localeCompare(right);
  });
}

export function buildKeybindingCommandOptions(
  keybindings: ResolvedKeybindingsConfig,
): ReadonlyArray<KeybindingCommandOption> {
  const commands = new Set<KeybindingCommand>(STATIC_KEYBINDING_COMMANDS);
  for (const binding of keybindings) {
    commands.add(binding.command);
  }
  return [...commands].toSorted((left, right) =>
    commandLabel(left).localeCompare(commandLabel(right)),
  );
}

export function commandLabel(command: KeybindingCommand): string {
  const raw = String(command);
  if (raw.startsWith("script.") && raw.endsWith(".run")) {
    return `Run Script: ${titleCaseCommandSegment(raw.slice("script.".length, -".run".length))}`;
  }
  return raw.split(".").map(titleCaseCommandSegment).join(": ");
}

function titleCaseCommandSegment(segment: string): string {
  const words: Array<string> = [];
  for (const part of segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[-_\s]+/)) {
    if (part.length > 0) {
      words.push(part.slice(0, 1).toUpperCase() + part.slice(1));
    }
  }
  return words.join(" ");
}

function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup") return "arrowup";
  if (normalized === "arrowdown") return "arrowdown";
  if (normalized === "arrowleft") return "arrowleft";
  if (normalized === "arrowright") return "arrowright";
  if (normalized.length === 1) return normalized;
  if (/^f\d{1,2}$/.test(normalized)) return normalized;
  if (normalized === "enter" || normalized === "tab" || normalized === "backspace") {
    return normalized;
  }
  if (normalized === "delete" || normalized === "home" || normalized === "end") {
    return normalized;
  }
  if (normalized === "pageup" || normalized === "pagedown") return normalized;
  return null;
}

export function keybindingFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  platform: string,
): string | null {
  const keyToken = normalizeShortcutKeyToken(shortcutKeyFromEvent(event));
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(platform)) {
    if (event.metaKey) parts.push("mod");
    if (event.ctrlKey) parts.push("ctrl");
  } else {
    if (event.ctrlKey) parts.push("mod");
    if (event.metaKey) parts.push("meta");
  }
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (parts.length === 0) {
    return null;
  }
  parts.push(keyToken);
  return parts.join("+");
}
