import { threadPullRequestSearchTerms } from "@t3tools/shared/threadPullRequests";
import type { CommandPaletteLinkedThreads } from "../commandPaletteBus";
import {
  type FilesystemBrowseEntry,
  type KeybindingCommand,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import { filterFilesystemBrowseEntries } from "@t3tools/client-runtime/state/filesystem";
import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import * as Arr from "effect/Array";
import * as Result from "effect/Result";
import { type ReactNode } from "react";
import { sortThreads } from "../lib/threadSort";
import { normalizeSearchText } from "../lib/utils";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { type Project, type SidebarThreadSummary, type Thread } from "../types";

export const RECENT_THREAD_LIMIT = 12;
export const ITEM_ICON_CLASS = "size-4 text-icon-muted";
export const ADDON_ICON_CLASS = "size-4";

/** A PR's relations include archived threads that normal palette search omits. */
export function buildLinkedThreadActionItems(
  input: CommandPaletteLinkedThreads & {
    query: string;
    icon: ReactNode;
    runThread: (thread: Pick<SidebarThreadSummary, "environmentId" | "id">) => Promise<void>;
  },
): CommandPaletteActionItem[] {
  return input.threads.map((thread) => ({
    kind: "action",
    value: `thread:${input.environmentId}:${thread.id}`,
    title: thread.title || "Untitled thread",
    description: thread.archivedAt === null ? "Linked thread" : "Archived thread",
    searchTerms: [input.query, thread.title],
    icon: input.icon,
    run: () => input.runThread({ environmentId: input.environmentId, id: thread.id }),
  }));
}

export function browseInputEndPaddingClass(input: {
  readonly willCreateProjectPath: boolean;
  readonly hasHighlightedBrowseItem: boolean;
}): string {
  if (input.willCreateProjectPath) {
    return "*:data-[slot=autocomplete-input]:pe-38!";
  }
  if (input.hasHighlightedBrowseItem) {
    return "*:data-[slot=autocomplete-input]:pe-30!";
  }
  return "*:data-[slot=autocomplete-input]:pe-24!";
}

/**
 * The global search overlay hosts three mutually exclusive surfaces: the
 * command palette (⌘K), the project file picker (⌘P), and project content
 * search (⇧⌘F). One reducer owns open/mode state so the surfaces can never
 * stack and re-triggering a mode's shortcut toggles it closed.
 */
export type SearchOverlayMode = "command" | "files" | "content";

export type CommandPaletteOpenIntent =
  | { readonly kind: "add-project" | "new-thread-in" }
  | {
      readonly kind: "search";
      readonly query: string;
      readonly linkedThreads?: CommandPaletteLinkedThreads;
    };

export interface CommandPaletteUiState {
  readonly open: boolean;
  readonly mode: SearchOverlayMode;
  readonly openIntent: CommandPaletteOpenIntent | null;
}

export type CommandPaletteUiAction =
  | { readonly _tag: "SetOpen"; readonly open: boolean }
  | { readonly _tag: "ToggleMode"; readonly mode: SearchOverlayMode }
  | {
      readonly _tag: "OpenSearch";
      readonly query: string;
      readonly linkedThreads?: CommandPaletteLinkedThreads;
    }
  | { readonly _tag: "OpenAddProject" }
  | { readonly _tag: "OpenNewThreadIn" }
  | { readonly _tag: "ClearOpenIntent" };

export function reduceCommandPaletteUiState(
  state: CommandPaletteUiState,
  action: CommandPaletteUiAction,
): CommandPaletteUiState {
  switch (action._tag) {
    case "SetOpen":
      return action.open
        ? { open: true, mode: "command", openIntent: state.openIntent }
        : { ...state, open: false, openIntent: null };
    case "ToggleMode":
      return state.open && state.mode === action.mode
        ? { ...state, open: false, openIntent: null }
        : { open: true, mode: action.mode, openIntent: null };
    case "OpenSearch":
      return {
        open: true,
        mode: "command",
        openIntent: {
          kind: "search",
          query: action.query,
          ...(action.linkedThreads ? { linkedThreads: action.linkedThreads } : {}),
        },
      };
    case "OpenAddProject":
      return { open: true, mode: "command", openIntent: { kind: "add-project" } };
    case "OpenNewThreadIn":
      return { open: true, mode: "command", openIntent: { kind: "new-thread-in" } };
    case "ClearOpenIntent":
      return state.openIntent ? { ...state, openIntent: null } : state;
  }
}

export interface CommandPaletteThreadContentMatch {
  readonly source: "user" | "assistant";
  readonly snippet: string;
  readonly query: string;
}

export interface CommandPaletteItem {
  readonly kind: "action" | "submenu";
  readonly value: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly threadContentMatch?: CommandPaletteThreadContentMatch;
  readonly timestamp?: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  /** Optional content rendered inline before the title text. */
  readonly titleLeadingContent?: ReactNode;
  /** Optional content rendered inline after the title text (before the timestamp). */
  readonly titleTrailingContent?: ReactNode;
  readonly shortcutCommand?: KeybindingCommand;
}

export interface CommandPaletteActionItem extends CommandPaletteItem {
  readonly kind: "action";
  readonly keepOpen?: boolean;
  readonly run: () => Promise<void>;
}

export interface CommandPaletteSubmenuItem extends CommandPaletteItem {
  readonly kind: "submenu";
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export interface CommandPaletteGroup {
  readonly value: string;
  readonly label: string;
  readonly items: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
}

export interface CommandPaletteView {
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export function enumerateCommandPaletteItems(
  items: ReadonlyArray<CommandPaletteActionItem>,
): CommandPaletteActionItem[] {
  return items.map((item, index) => {
    const shortcutCommand = THREAD_JUMP_KEYBINDING_COMMANDS[index];
    if (shortcutCommand) return { ...item, shortcutCommand };

    const { shortcutCommand: _shortcutCommand, ...itemWithoutShortcut } = item;
    return itemWithoutShortcut;
  });
}

export type CommandPaletteMode = "root" | "root-browse" | "submenu" | "submenu-browse";

// A project as the palette shows it. `displayName` is the grouped label (for
// example "owner/repo" when projects are merged across machines). Keep `title`
// as the real project title: the automatic project icon is derived from it, and
// every other surface uses the real title, so overriding it desyncs the icon.
export type CommandPaletteProject = Project & { readonly displayName: string };

export function buildProjectActionItems(input: {
  projects: ReadonlyArray<CommandPaletteProject>;
  valuePrefix: string;
  icon: (project: CommandPaletteProject) => ReactNode;
  runProject: (project: CommandPaletteProject) => Promise<void>;
  searchTerms?: (project: CommandPaletteProject) => ReadonlyArray<string>;
  renderDescription?: (project: CommandPaletteProject) => ReactNode;
  shortcutCommand?: KeybindingCommand;
}): CommandPaletteActionItem[] {
  return input.projects.map((project) => ({
    kind: "action",
    value: `${input.valuePrefix}:${project.environmentId}:${project.id}`,
    searchTerms: [
      project.displayName,
      project.title,
      project.workspaceRoot,
      ...(input.searchTerms?.(project) ?? []),
    ],
    title: project.displayName,
    description: input.renderDescription?.(project) ?? project.workspaceRoot,
    icon: input.icon(project),
    ...(input.shortcutCommand !== undefined ? { shortcutCommand: input.shortcutCommand } : {}),
    run: async () => {
      await input.runProject(project);
    },
  }));
}

export type BuildThreadActionItemsThread = Pick<
  SidebarThreadSummary,
  | "archivedAt"
  | "branch"
  | "createdAt"
  | "environmentId"
  | "id"
  | "modelSelection"
  | "projectId"
  | "session"
  | "title"
  | "worktreePath"
> & {
  pullRequests?: SidebarThreadSummary["pullRequests"];
  updatedAt: string;
  latestUserMessageAt?: string | null;
};

export function buildThreadActionItems<TThread extends BuildThreadActionItemsThread>(input: {
  threads: ReadonlyArray<TThread>;
  activeThreadId?: Thread["id"];
  projectTitleById: ReadonlyMap<Project["id"], string>;
  sortOrder: SidebarThreadSortOrder;
  icon: ReactNode;
  /** Optional content rendered inline before the title text per-thread. */
  renderLeadingContent?: (thread: TThread) => ReactNode;
  /** Optional content rendered inline after the title text per-thread. */
  renderTrailingContent?: (thread: TThread) => ReactNode;
  /** Optional rich description (e.g. favicon + workspace icons). Falls back to text. */
  renderDescription?: (thread: TThread, meta: { projectTitle: string | undefined }) => ReactNode;
  getContentMatch?: (thread: TThread) => CommandPaletteThreadContentMatch | undefined;
  runThread: (thread: Pick<SidebarThreadSummary, "environmentId" | "id">) => Promise<void>;
  limit?: number;
}): CommandPaletteActionItem[] {
  const sortedThreads = sortThreads(
    input.threads.filter((thread) => thread.archivedAt === null),
    input.sortOrder,
  );
  const visibleThreads =
    input.limit === undefined ? sortedThreads : sortedThreads.slice(0, input.limit);

  return visibleThreads.map((thread) => {
    const projectTitle = input.projectTitleById.get(thread.projectId);
    const descriptionParts: string[] = [];

    if (projectTitle) {
      descriptionParts.push(projectTitle);
    }
    if (thread.branch) {
      descriptionParts.push(`#${thread.branch}`);
    }
    if (thread.id === input.activeThreadId) {
      descriptionParts.push("Current thread");
    }

    const leadingContent = input.renderLeadingContent?.(thread);
    const trailingContent = input.renderTrailingContent?.(thread);
    const contentMatch = input.getContentMatch?.(thread);
    const description = input.renderDescription
      ? input.renderDescription(thread, { projectTitle })
      : descriptionParts.join(` · `);

    return Object.assign(
      {
        kind: "action" as const,
        value: `thread:${thread.id}`,
        searchTerms: [
          thread.title,
          ...threadPullRequestSearchTerms(thread),
          projectTitle ?? ``,
          thread.branch ?? ``,
          contentMatch?.snippet ?? ``,
        ],
        title: thread.title,
        description,
        timestamp: formatRelativeTimeLabel(
          thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
        ),
        icon: input.icon,
      },
      leadingContent ? { titleLeadingContent: leadingContent } : {},
      trailingContent ? { titleTrailingContent: trailingContent } : {},
      contentMatch ? { threadContentMatch: contentMatch } : {},
      {
        run: async () => {
          await input.runThread(thread);
        },
      },
    );
  });
}

function rankSearchFieldMatch(
  field: string,
  normalizedQuery: string,
  queryTokens: ReadonlyArray<string>,
): number {
  const normalizedField = normalizeSearchText(field);
  if (
    normalizedField.length === 0 ||
    !queryTokens.every((token) => normalizedField.includes(token))
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  if (normalizedField === normalizedQuery) {
    return 3;
  }
  if (normalizedField.startsWith(normalizedQuery)) {
    return 2;
  }
  if (normalizedField.includes(normalizedQuery)) {
    return 1;
  }
  return 0;
}

function rankCommandPaletteItemMatch(
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem,
  normalizedQuery: string,
  queryTokens: ReadonlyArray<string>,
): number {
  const terms = item.searchTerms.filter((term) => term.length > 0);
  if (terms.length === 0) {
    return 0;
  }

  for (const [index, field] of terms.entries()) {
    const fieldRank = rankSearchFieldMatch(field, normalizedQuery, queryTokens);
    if (fieldRank !== Number.NEGATIVE_INFINITY) {
      return 1_000 - index * 100 + fieldRank;
    }
  }

  return 0;
}

export function filterCommandPaletteGroups(input: {
  activeGroups: ReadonlyArray<CommandPaletteGroup>;
  query: string;
  isInSubmenu: boolean;
  projectSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  settingsSearchItems?: ReadonlyArray<CommandPaletteActionItem>;
  threadSearchItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const isActionsFilter = input.query.startsWith(">");
  const searchQuery = isActionsFilter ? input.query.slice(1) : input.query;
  const normalizedQuery = normalizeSearchText(searchQuery);

  if (normalizedQuery.length === 0) {
    if (isActionsFilter) {
      return input.activeGroups.filter((group) => group.value === "actions");
    }
    return [...input.activeGroups];
  }
  const queryTokens = normalizedQuery.split(" ");

  let baseGroups = [...input.activeGroups];
  if (isActionsFilter) {
    baseGroups = baseGroups.filter((group) => group.value === "actions");
  } else if (!input.isInSubmenu) {
    baseGroups = baseGroups.filter((group) => group.value !== "recent-threads");
  }

  const searchableGroups = [...baseGroups];
  if (!input.isInSubmenu && !isActionsFilter) {
    if (input.projectSearchItems.length > 0) {
      searchableGroups.push({
        value: "projects-search",
        label: "Projects",
        items: input.projectSearchItems,
      });
    }
    if (input.settingsSearchItems && input.settingsSearchItems.length > 0) {
      searchableGroups.push({
        value: "settings-search",
        label: "Settings",
        items: input.settingsSearchItems,
      });
    }
    if (input.threadSearchItems.length > 0) {
      searchableGroups.push({
        value: "threads-search",
        label: "Threads",
        items: input.threadSearchItems,
      });
    }
  }

  return searchableGroups.flatMap((group) => {
    const items = Arr.filterMap(group.items, (item, index) => {
      const haystack = normalizeSearchText(item.searchTerms.join(" "));
      if (!queryTokens.every((token) => haystack.includes(token))) {
        return Result.failVoid;
      }

      return Result.succeed({
        item,
        index,
        rank: rankCommandPaletteItemMatch(item, normalizedQuery, queryTokens),
      });
    })
      .toSorted((left, right) => right.rank - left.rank || left.index - right.index)
      .map((entry) => entry.item);

    if (items.length === 0) {
      return [];
    }

    return [{ value: group.value, label: group.label, items }];
  });
}

export function buildBrowseGroups(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseQuery: string;
  canBrowseUp: boolean;
  upIcon: ReactNode;
  directoryIcon: ReactNode;
  browseUp: () => void | Promise<void>;
  browseTo: (name: string) => void | Promise<void>;
}): CommandPaletteGroup[] {
  const items: CommandPaletteActionItem[] = [];

  if (input.canBrowseUp) {
    items.push({
      kind: "action",
      value: "browse:up",
      searchTerms: [input.browseQuery, ".."],
      title: "..",
      icon: input.upIcon,
      keepOpen: true,
      run: async () => {
        await input.browseUp();
      },
    });
  }

  for (const entry of input.browseEntries) {
    items.push({
      kind: "action",
      value: `browse:${entry.fullPath}`,
      searchTerms: [input.browseQuery, entry.fullPath, entry.name],
      title: entry.name,
      icon: input.directoryIcon,
      keepOpen: true,
      run: async () => {
        await input.browseTo(entry.name);
      },
    });
  }

  return [{ value: "directories", label: "Directories", items }];
}

export function filterPinnedBrowseEntries(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  filterQuery: string;
  pinnedDirectoryName: string;
  caseSensitive: boolean;
}): ReturnType<typeof filterFilesystemBrowseEntries> {
  const namesMatch = (left: string, right: string) =>
    input.caseSensitive ? left === right : left.toLowerCase() === right.toLowerCase();
  const visibleFilterQuery = namesMatch(input.filterQuery, input.pinnedDirectoryName)
    ? ""
    : input.filterQuery;
  const { visibleEntries } = filterFilesystemBrowseEntries(input.browseEntries, visibleFilterQuery);
  const exactEntry =
    input.filterQuery.length > 0
      ? (input.browseEntries.find((entry) => namesMatch(entry.name, input.filterQuery)) ?? null)
      : null;
  return { visibleEntries, exactEntry };
}

export function getCommandPaletteMode(input: {
  currentView: CommandPaletteView | null;
  isBrowsing: boolean;
}): CommandPaletteMode {
  if (input.currentView) {
    return input.isBrowsing ? "submenu-browse" : "submenu";
  }
  return input.isBrowsing ? "root-browse" : "root";
}

export function buildRootGroups(input: {
  actionItems: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  recentThreadItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const groups: CommandPaletteGroup[] = [];
  if (input.actionItems.length > 0) {
    groups.push({ value: "actions", label: "Actions", items: input.actionItems });
  }
  if (input.recentThreadItems.length > 0) {
    groups.push({
      value: "recent-threads",
      label: "Recent Threads",
      items: input.recentThreadItems,
    });
  }
  return groups;
}

export function getCommandPaletteInputPlaceholder(mode: CommandPaletteMode): string {
  switch (mode) {
    case "root":
      return "Search commands, projects, and threads...";
    case "root-browse":
      return "Enter project path (e.g. ~/projects/my-app)";
    case "submenu":
      return "Search...";
    case "submenu-browse":
      return "Enter path (e.g. ~/projects/my-app)";
  }
}

/* agent-watermark: model=muse-spark; effort=high; duration=35m; seat=opencode; date=2026-10-10 */
// --- Go-anywhere destinations + recent history ---
// Pure helpers only (no navigation side effects): the .tsx wires `run`.

export interface GoAnywhereDestination {
  readonly value: string;
  readonly title: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly description: string;
}

/** First-class "go to" targets: every main route + every settings panel. */
export const GO_ANYWHERE_DESTINATIONS: ReadonlyArray<GoAnywhereDestination> = [
  { value: "go:command-center", title: "Go to Command Center", searchTerms: ["go to", "command center", "dashboard"], description: "Command Center" },
  { value: "go:usage", title: "Go to Usage", searchTerms: ["go to", "usage", "costs", "tokens"], description: "Usage" },
  { value: "go:routines", title: "Go to Routines", searchTerms: ["go to", "routines", "automation"], description: "Routines" },
  { value: "go:shortcuts", title: "Show keyboard shortcuts", searchTerms: ["keyboard", "shortcuts", "keybindings", "hotkeys", "cheat sheet", "help"], description: "⌘/" },
  { value: "go:race", title: "Go to Race", searchTerms: ["go to", "race", "compare"], description: "Race" },
  { value: "go:settings:general", title: "Go to Settings — General", searchTerms: ["go to", "settings", "general", "preferences"], description: "Settings · General" },
  { value: "go:settings:appearance", title: "Go to Settings — Appearance", searchTerms: ["go to", "settings", "appearance", "theme", "palette"], description: "Settings · Appearance" },
  { value: "go:settings:projects", title: "Go to Settings — Projects", searchTerms: ["go to", "settings", "projects"], description: "Settings · Projects" },
  { value: "go:settings:keybindings", title: "Go to Settings — Keybindings", searchTerms: ["go to", "settings", "keybindings", "shortcuts"], description: "Settings · Keybindings" },
  { value: "go:settings:providers", title: "Go to Settings — Providers", searchTerms: ["go to", "settings", "providers", "models"], description: "Settings · Providers" },
  { value: "go:settings:integrations", title: "Go to Settings — Integrations", searchTerms: ["go to", "settings", "integrations"], description: "Settings · Integrations" },
  { value: "go:settings:skills", title: "Go to Settings — Skills", searchTerms: ["go to", "settings", "skills", "rules"], description: "Settings · Skills" },
  { value: "go:settings:source-control", title: "Go to Settings — Source Control", searchTerms: ["go to", "settings", "source control", "git"], description: "Settings · Source Control" },
  { value: "go:settings:connections", title: "Go to Settings — Connections", searchTerms: ["go to", "settings", "connections", "devices"], description: "Settings · Connections" },
  { value: "go:settings:diagnostics", title: "Go to Settings — Diagnostics", searchTerms: ["go to", "settings", "diagnostics", "debug"], description: "Settings · Diagnostics" },
];

export function buildGoAnywhereItems(input: {
  icon: ReactNode;
  runDestination: (destination: GoAnywhereDestination) => Promise<void>;
}): CommandPaletteActionItem[] {
  return GO_ANYWHERE_DESTINATIONS.map((destination) => ({
    kind: "action" as const,
    value: destination.value,
    searchTerms: [...destination.searchTerms, destination.title],
    title: destination.title,
    description: destination.description,
    icon: input.icon,
    run: async () => {
      await input.runDestination(destination);
    },
  }));
}

export const RECENT_DESTINATIONS_STORAGE_KEY = "t3code:palette-recent-destinations:v1";
export const RECENT_PROJECTS_STORAGE_KEY = "t3code:palette-recent-projects:v1";
const RECENT_HISTORY_LIMIT = 8;

function readRecentKeys(storageKey: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, RECENT_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeRecentKeys(storageKey: string, keys: ReadonlyArray<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(keys.slice(0, RECENT_HISTORY_LIMIT)));
  } catch {
    // Blocked storage must never break the palette.
  }
}

export function readRecentDestinationKeys(): string[] {
  return readRecentKeys(RECENT_DESTINATIONS_STORAGE_KEY);
}

export function recordRecentDestinationKey(value: string): string[] {
  const next = [value, ...readRecentKeys(RECENT_DESTINATIONS_STORAGE_KEY).filter((key) => key !== value)].slice(0, RECENT_HISTORY_LIMIT);
  writeRecentKeys(RECENT_DESTINATIONS_STORAGE_KEY, next);
  return next;
}

export function readRecentProjectKeys(): string[] {
  return readRecentKeys(RECENT_PROJECTS_STORAGE_KEY);
}

export function recordRecentProjectKey(value: string): string[] {
  const next = [value, ...readRecentKeys(RECENT_PROJECTS_STORAGE_KEY).filter((key) => key !== value)].slice(0, RECENT_HISTORY_LIMIT);
  writeRecentKeys(RECENT_PROJECTS_STORAGE_KEY, next);
  return next;
}

/** Recent-first stable ordering: recent keys float up, everything else keeps order. */
export function orderByRecentKeys<TItem>(items: ReadonlyArray<TItem>, recentKeys: ReadonlyArray<string>, keyOf: (item: TItem) => string): TItem[] {
  if (recentKeys.length === 0) return [...items];
  const rank = new Map(recentKeys.map((key, index) => [key, index] as const));
  return [...items].toSorted((left, right) => {
    const leftRank = rank.get(keyOf(left)) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(keyOf(right)) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
}
