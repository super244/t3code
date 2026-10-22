/* agent-watermark: model=opus-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-22 */
import type {
  MemoryEntry,
  MemoryScope,
  MemorySource,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

/**
 * Pure rules for persistent memory: how a save or a delete changes the list,
 * which entries a session sees, and the brief a new session starts with. The
 * server stores the list; agents and the app go through these rules.
 */

/** Entries kept per scope (each project, and global); the oldest go first. */
export const MEMORY_MAX_ENTRIES_PER_SCOPE = 200;

/** The brief stays small so it never crowds out the user's own prompt. */
export const MEMORY_BRIEF_MAX_CHARS = 6_000;

export interface MemorySaveRequest {
  readonly id?: string | undefined;
  readonly scope: MemoryScope;
  readonly projectId: ProjectId | null;
  readonly text: string;
  readonly source: MemorySource;
  readonly threadId: ThreadId | null;
  readonly author: string | null;
}

export type MemorySaveOutcome =
  | { readonly kind: "saved"; readonly entries: MemoryEntry[]; readonly entry: MemoryEntry }
  | { readonly kind: "missing"; readonly id: string }
  | { readonly kind: "invalid"; readonly reason: string };

function sameScope(entry: MemoryEntry, scope: MemoryScope, projectId: ProjectId | null): boolean {
  return entry.scope === scope && (scope === "global" || entry.projectId === projectId);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Adds or edits one entry. Saving text that is already remembered in the same
 * scope refreshes that entry instead of adding a duplicate, which keeps agents
 * that re-save the same fact every session from filling memory up.
 */
export function saveMemoryEntry(
  entries: ReadonlyArray<MemoryEntry>,
  request: MemorySaveRequest,
  now: string,
  newId: () => string,
): MemorySaveOutcome {
  const projectId = request.scope === "project" ? request.projectId : null;
  if (request.scope === "project" && projectId === null) {
    return { kind: "invalid", reason: "Project memory needs a project." };
  }
  const text = request.text.trim();
  if (text.length === 0) return { kind: "invalid", reason: "Memory text is empty." };

  if (request.id !== undefined) {
    const existing = entries.find((entry) => entry.id === request.id);
    if (!existing) return { kind: "missing", id: request.id };
    const entry: MemoryEntry = {
      ...existing,
      scope: request.scope,
      projectId,
      text,
      updatedAt: now,
    };
    return {
      kind: "saved",
      entry,
      entries: entries.map((item) => (item.id === entry.id ? entry : item)),
    };
  }

  const duplicate = entries.find(
    (entry) =>
      sameScope(entry, request.scope, projectId) &&
      normalizeText(entry.text) === normalizeText(text),
  );
  if (duplicate) {
    const entry: MemoryEntry = { ...duplicate, updatedAt: now };
    return {
      kind: "saved",
      entry,
      entries: entries.map((item) => (item.id === entry.id ? entry : item)),
    };
  }

  const entry: MemoryEntry = {
    id: newId(),
    scope: request.scope,
    projectId,
    text,
    source: request.source,
    threadId: request.threadId,
    author: request.author,
    createdAt: now,
    updatedAt: now,
  };
  const inScope = entries
    .filter((item) => sameScope(item, request.scope, projectId))
    .toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  const overflow = new Set(
    inScope
      .slice(0, Math.max(0, inScope.length + 1 - MEMORY_MAX_ENTRIES_PER_SCOPE))
      .map((item) => item.id),
  );
  return {
    kind: "saved",
    entry,
    entries: [entry, ...entries.filter((item) => !overflow.has(item.id))],
  };
}

/** What a session in this project can see: its project's memory, then global; newest first. */
export function memoryForProject(
  entries: ReadonlyArray<MemoryEntry>,
  projectId: ProjectId | null,
): MemoryEntry[] {
  const newest = (left: MemoryEntry, right: MemoryEntry) =>
    right.updatedAt.localeCompare(left.updatedAt);
  return [
    ...entries
      .filter(
        (entry) => entry.scope === "project" && projectId !== null && entry.projectId === projectId,
      )
      .toSorted(newest),
    ...entries.filter((entry) => entry.scope === "global").toSorted(newest),
  ];
}

/** Entries whose text contains every word of the query, case-insensitively. */
export function searchMemory(
  entries: ReadonlyArray<MemoryEntry>,
  query: string | undefined,
): MemoryEntry[] {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((entry) => {
    const text = entry.text.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * The block a new agent session receives before its first prompt, or null
 * when there is nothing to remember. Newest entries win when it would run
 * long, and it says how many it left out so the agent knows to `recall`.
 */
export function buildMemoryBrief(
  entries: ReadonlyArray<MemoryEntry>,
  projectTitle: string | null,
): string | null {
  if (entries.length === 0) return null;
  const header = [
    "<t3_memory>",
    `Persistent memory${projectTitle ? ` for the project "${projectTitle}"` : ""} saved by the user and by earlier agent sessions. Treat it as background you already know; the user's message below is what to do now. Save new lasting facts (preferences, decisions, conventions, gotchas) with the t3-code \`remember\` tool, and use \`forget\` when one here is wrong.`,
  ];
  const footer = "</t3_memory>";
  const lines: string[] = [];
  let length = header.join("\n").length + footer.length + 2;
  let shown = 0;
  for (const entry of entries) {
    const line = `- [${entry.scope === "global" ? "global" : "project"} · ${entry.id}] ${entry.text}`;
    if (length + line.length + 1 > MEMORY_BRIEF_MAX_CHARS) break;
    lines.push(line);
    length += line.length + 1;
    shown += 1;
  }
  const omitted = entries.length - shown;
  if (omitted > 0) {
    lines.push(
      `(${omitted} older ${omitted === 1 ? "entry" : "entries"} not shown; use \`recall\` to search them.)`,
    );
  }
  return [...header, ...lines, footer].join("\n");
}
