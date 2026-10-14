/* agent-watermark: model=haiku-5.5; effort=high; duration=65m; seat=claude-code; date=2026-10-13 */
import type {
  EnvironmentId,
  OrchestrationThreadSearchMatch,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import { normalizeSearchText } from "~/lib/utils";

export const THREAD_SEARCH_MIN_QUERY_LENGTH = 2;

/** The slice of a thread shell the surface needs. Titles match on the client. */
export interface ThreadSearchThread {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly archivedAt: string | null;
  readonly updatedAt: string;
}

export interface ThreadSearchProject {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly title: string;
}

export interface ThreadSearchMessageRow {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: string;
  readonly source: OrchestrationThreadSearchMatch["source"];
  readonly snippet: string;
  readonly createdAt: string | null;
}

export interface ThreadSearchThreadGroup {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly archived: boolean;
  readonly titleMatched: boolean;
  readonly updatedAt: string;
  readonly messages: ReadonlyArray<ThreadSearchMessageRow>;
}

export interface ThreadSearchProjectGroup {
  readonly key: string;
  readonly title: string;
  readonly threads: ReadonlyArray<ThreadSearchThreadGroup>;
}

/** Every row the keyboard can land on, in the order it is drawn. */
export type ThreadSearchSelectable =
  | { readonly kind: "thread"; readonly thread: ThreadSearchThreadGroup }
  | {
      readonly kind: "message";
      readonly thread: ThreadSearchThreadGroup;
      readonly message: ThreadSearchMessageRow;
    };

export interface ThreadSearchModel {
  readonly projects: ReadonlyArray<ThreadSearchProjectGroup>;
  readonly selectables: ReadonlyArray<ThreadSearchSelectable>;
  readonly threadCount: number;
  readonly messageCount: number;
}

export function threadSearchKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `${environmentId}:${threadId}`;
}

export function threadSearchAuthorLabel(source: OrchestrationThreadSearchMatch["source"]): string {
  return source === "user" ? "You" : "Agent";
}

/** Split text into alternating plain and matched runs. Case-insensitive, non-overlapping. */
export function splitHighlightedText(
  text: string,
  query: string,
): ReadonlyArray<{ readonly text: string; readonly matched: boolean }> {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0 || text.length === 0) return [{ text, matched: false }];
  const haystack = text.toLowerCase();
  const parts: Array<{ text: string; matched: boolean }> = [];
  let cursor = 0;
  let found = haystack.indexOf(needle, cursor);
  while (found !== -1) {
    if (found > cursor) parts.push({ text: text.slice(cursor, found), matched: false });
    parts.push({ text: text.slice(found, found + needle.length), matched: true });
    cursor = found + needle.length;
    found = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), matched: false });
  return parts;
}

/** Titles match on every word of the query, the way the palette matches titles. */
export function threadTitleMatchesQuery(title: string, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return false;
  const normalizedTitle = normalizeSearchText(title);
  return normalizedQuery.split(" ").every((token) => normalizedTitle.includes(token));
}

function byNewest(left: string | null, right: string | null): number {
  return (right ?? "").localeCompare(left ?? "");
}

/**
 * Groups message matches under their project and thread, adds threads whose
 * title matches even when no message does, and orders everything newest first.
 * `matches` comes straight from the server, so the matching stays server-side;
 * this only shapes the rows the surface draws.
 */
export function buildThreadSearchModel(input: {
  readonly query: string;
  readonly threads: ReadonlyArray<ThreadSearchThread>;
  readonly projects: ReadonlyArray<ThreadSearchProject>;
  readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
  readonly unknownProjectLabel?: string;
}): ThreadSearchModel {
  const threadsByKey = new Map<string, ThreadSearchThread>();
  for (const thread of input.threads) {
    threadsByKey.set(threadSearchKey(thread.environmentId, thread.id), thread);
  }
  const projectTitleByKey = new Map<string, string>();
  for (const project of input.projects) {
    projectTitleByKey.set(`${project.environmentId}:${project.id}`, project.title);
  }

  const messagesByThreadKey = new Map<string, ThreadSearchMessageRow[]>();
  for (const match of input.matches) {
    const key = threadSearchKey(match.environmentId, match.threadId);
    const rows = messagesByThreadKey.get(key) ?? [];
    rows.push({
      key: `${key}:${match.messageId}`,
      environmentId: match.environmentId,
      threadId: match.threadId,
      messageId: match.messageId,
      source: match.source,
      snippet: match.snippet,
      createdAt: match.messageCreatedAt,
    });
    messagesByThreadKey.set(key, rows);
  }

  const groupsByThreadKey = new Map<string, ThreadSearchThreadGroup>();
  const addThread = (thread: ThreadSearchThread, titleMatched: boolean) => {
    const key = threadSearchKey(thread.environmentId, thread.id);
    if (groupsByThreadKey.has(key)) return;
    const messages = [...(messagesByThreadKey.get(key) ?? [])].toSorted((left, right) =>
      byNewest(left.createdAt, right.createdAt),
    );
    groupsByThreadKey.set(key, {
      key,
      environmentId: thread.environmentId,
      threadId: thread.id,
      title: thread.title,
      archived: thread.archivedAt !== null,
      titleMatched,
      updatedAt: thread.updatedAt,
      messages,
    });
  };

  for (const thread of input.threads) {
    const titleMatched = threadTitleMatchesQuery(thread.title, input.query);
    const hasMessages = messagesByThreadKey.has(threadSearchKey(thread.environmentId, thread.id));
    if (titleMatched || hasMessages) addThread(thread, titleMatched);
  }
  // A match can arrive for a thread whose shell this client has not loaded.
  // Keep it, with the thread's id as its title, rather than dropping real results.
  for (const [key, rows] of messagesByThreadKey) {
    if (groupsByThreadKey.has(key) || rows.length === 0) continue;
    const first = rows[0]!;
    addThread(
      {
        environmentId: first.environmentId,
        id: first.threadId,
        projectId: "" as ProjectId,
        title: "Untitled thread",
        archivedAt: null,
        updatedAt: first.createdAt ?? "",
      },
      false,
    );
  }

  const projectGroups = new Map<
    string,
    { key: string; title: string; threads: ThreadSearchThreadGroup[] }
  >();
  for (const group of groupsByThreadKey.values()) {
    const thread = threadsByKey.get(group.key);
    const projectKey = thread
      ? `${thread.environmentId}:${thread.projectId}`
      : `unknown:${group.environmentId}`;
    const title =
      (thread && projectTitleByKey.get(projectKey)) ??
      input.unknownProjectLabel ??
      "Unknown project";
    const project = projectGroups.get(projectKey) ?? { key: projectKey, title, threads: [] };
    project.threads.push(group);
    projectGroups.set(projectKey, project);
  }

  const projects = [...projectGroups.values()]
    .map((project) => ({
      key: project.key,
      title: project.title,
      threads: project.threads.toSorted((left, right) => byNewest(left.updatedAt, right.updatedAt)),
    }))
    .toSorted((left, right) =>
      byNewest(left.threads[0]?.updatedAt ?? null, right.threads[0]?.updatedAt ?? null),
    );

  const selectables: ThreadSearchSelectable[] = [];
  let messageCount = 0;
  for (const project of projects) {
    for (const thread of project.threads) {
      selectables.push({ kind: "thread", thread });
      for (const message of thread.messages) {
        selectables.push({ kind: "message", thread, message });
        messageCount += 1;
      }
    }
  }

  return {
    projects,
    selectables,
    threadCount: groupsByThreadKey.size,
    messageCount,
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The line under the search box. Each state says what is true: how many
 * threads were searched, whether results are still arriving, and what a
 * no-result search covered.
 */
export function threadSearchStatus(input: {
  readonly query: string;
  readonly searchableThreadCount: number;
  readonly isPending: boolean;
  readonly threadCount: number;
  readonly messageCount: number;
}): { readonly tone: "muted" | "destructive"; readonly text: string; readonly hint?: string } {
  const searchable = plural(input.searchableThreadCount, "thread");
  if (input.query.trim().length < THREAD_SEARCH_MIN_QUERY_LENGTH) {
    return input.searchableThreadCount === 0
      ? {
          tone: "muted",
          text: "No threads to search yet.",
          hint: "Start a thread, then search its messages here.",
        }
      : {
          tone: "muted",
          text: `Type at least ${THREAD_SEARCH_MIN_QUERY_LENGTH} characters to search ${searchable}.`,
        };
  }
  if (input.isPending) {
    return { tone: "muted", text: `Searching ${searchable}…` };
  }
  if (input.threadCount === 0) {
    if (input.searchableThreadCount === 0) {
      return { tone: "muted", text: "No threads to search yet." };
    }
    return {
      tone: "muted",
      text: `No matches in ${searchable}.`,
      hint: "Searches thread titles and message text, including archived threads.",
    };
  }
  return {
    tone: "muted",
    text: `${plural(input.threadCount, "thread")} · ${plural(input.messageCount, "message")}`,
  };
}
