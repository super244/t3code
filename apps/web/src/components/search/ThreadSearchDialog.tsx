/* agent-watermark: model=haiku-5.5; effort=high; duration=65m; seat=claude-code; date=2026-10-13 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useEnvironments } from "~/state/environments";
import { useProjects, useThreadShells } from "~/state/entities";
import { useThreadSearch } from "~/state/queries";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { buildThreadRouteParams } from "../../threadRoutes";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import {
  buildThreadSearchModel,
  splitHighlightedText,
  threadSearchAuthorLabel,
  threadSearchStatus,
  THREAD_SEARCH_MIN_QUERY_LENGTH,
  type ThreadSearchSelectable,
  type ThreadSearchThreadGroup,
} from "./threadSearch.logic";

/** Up to three snippets per thread keeps the list scannable and the query cheap. */
const THREAD_SEARCH_OPTIONS = { matchesPerThread: 3, includeArchived: true } as const;

function HighlightedText(props: { readonly text: string; readonly query: string }) {
  return (
    <>
      {splitHighlightedText(props.text, props.query).map((part, index) =>
        part.matched ? (
          <mark className="bg-transparent font-semibold text-foreground" key={index}>
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function ThreadRow(props: {
  readonly thread: ThreadSearchThreadGroup;
  readonly query: string;
  readonly index: number;
  readonly active: boolean;
  readonly onHighlight: () => void;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-thread-search-index={props.index}
      data-thread-search-kind="thread"
      className={cn(
        "flex min-h-9 w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent/60 sm:min-h-8",
        props.active && "bg-accent text-accent-foreground",
      )}
      onMouseEnter={props.onHighlight}
      onClick={props.onOpen}
    >
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        <HighlightedText text={props.thread.title} query={props.query} />
      </span>
      {props.thread.archived ? (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          Archived
        </span>
      ) : null}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
        {formatRelativeTimeLabel(props.thread.updatedAt)}
      </span>
    </button>
  );
}

function MessageRow(props: {
  readonly selectable: Extract<ThreadSearchSelectable, { kind: "message" }>;
  readonly query: string;
  readonly index: number;
  readonly active: boolean;
  readonly onHighlight: () => void;
  readonly onOpen: () => void;
}) {
  const { message } = props.selectable;
  const isUser = message.source === "user";
  return (
    <button
      type="button"
      data-thread-search-index={props.index}
      data-thread-search-kind="message"
      className={cn(
        "flex w-full min-w-0 items-start gap-2 py-1.5 ps-6 pe-3 text-left hover:bg-accent/60",
        props.active && "bg-accent text-accent-foreground",
      )}
      onMouseEnter={props.onHighlight}
      onClick={props.onOpen}
    >
      <span
        className={cn(
          "mt-px w-10 shrink-0 text-xs font-medium",
          isUser ? "text-blue-400" : "text-emerald-400",
        )}
      >
        {threadSearchAuthorLabel(message.source)}
      </span>
      <span className="line-clamp-2 min-w-0 flex-1 break-words text-xs leading-relaxed text-muted-foreground">
        <HighlightedText text={message.snippet} query={props.query} />
      </span>
      <span className="mt-px shrink-0 text-xs tabular-nums text-muted-foreground/70">
        {message.createdAt ? formatRelativeTimeLabel(message.createdAt) : ""}
      </span>
    </button>
  );
}

function StatusLine(props: {
  readonly text: string;
  readonly tone: "muted" | "destructive";
  readonly pending: boolean;
}) {
  return (
    <div
      role="status"
      className="flex min-h-9 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground"
    >
      {props.pending ? <Spinner className="size-3.5" /> : null}
      <span className={cn("truncate", props.tone === "destructive" && "text-destructive")}>
        {props.text}
      </span>
    </div>
  );
}

export function ThreadSearchDialog(props: {
  readonly initialQuery?: string | undefined;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const threads = useThreadShells();
  const projects = useProjects();
  const [query, setQuery] = useState(props.initialQuery ?? "");
  // The selection belongs to the query it was made under, so a new query starts at the top
  // without an effect that resets state after render.
  const [selection, setSelection] = useState({ query: "", index: 0 });

  const environmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connection.phase === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  const trimmedQuery = query.trim();
  const activeQuery = trimmedQuery.length >= THREAD_SEARCH_MIN_QUERY_LENGTH ? trimmedQuery : "";
  const search = useThreadSearch(environmentIds, activeQuery, THREAD_SEARCH_OPTIONS);
  const model = useMemo(
    () =>
      buildThreadSearchModel({
        query: activeQuery,
        threads: activeQuery === "" ? [] : threads,
        projects,
        matches: activeQuery === "" ? [] : search.matches,
      }),
    [activeQuery, projects, search.matches, threads],
  );
  const status = threadSearchStatus({
    query,
    searchableThreadCount: threads.length,
    isPending: search.isPending,
    threadCount: model.threadCount,
    messageCount: model.messageCount,
  });

  const selectedIndex = selection.query === activeQuery ? selection.index : 0;
  const setSelectedIndex = (update: number | ((current: number) => number)) => {
    setSelection((previous) => {
      const current = previous.query === activeQuery ? previous.index : 0;
      const index = typeof update === "function" ? update(current) : update;
      return { query: activeQuery, index };
    });
  };
  const activeIndex = Math.min(selectedIndex, Math.max(model.selectables.length - 1, 0));
  const active = model.selectables[activeIndex] ?? null;

  useEffect(() => {
    document
      .querySelector<HTMLElement>(`[data-thread-search-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const openSelectable = (selectable: ThreadSearchSelectable) => {
    const thread = selectable.thread;
    props.onOpenChange(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.threadId)),
      ...(selectable.kind === "message"
        ? { search: { message: selectable.message.messageId } }
        : {}),
    });
  };

  const selectableIndexOfThread = (thread: ThreadSearchThreadGroup) =>
    model.selectables.findIndex((item) => item.kind === "thread" && item.thread.key === thread.key);

  const hasQuery = activeQuery !== "";
  let body: ReactNode;
  if (!hasQuery) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <span className="text-sm text-foreground">Search every thread</span>
        <span className="text-xs text-muted-foreground/80">
          Find a decision, a command or a file name in any thread, including archived ones.
        </span>
      </div>
    );
  } else if (model.selectables.length === 0) {
    body = (
      <div
        role="status"
        className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center"
      >
        <span className="text-sm text-foreground">{status.text}</span>
        {status.hint ? (
          <span className="text-xs text-muted-foreground/80">{status.hint}</span>
        ) : null}
      </div>
    );
  } else {
    body = (
      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="py-2">
          {model.projects.map((project) => (
            <section className="pb-2" key={project.key}>
              <div className="sticky top-0 z-10 flex h-8 items-center gap-2 bg-popover/95 px-3 text-xs backdrop-blur-sm">
                <span className="min-w-0 truncate font-medium text-foreground">
                  {project.title}
                </span>
                <span className="ms-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {project.threads.length}
                </span>
              </div>
              {project.threads.map((thread) => {
                const threadIndex = selectableIndexOfThread(thread);
                return (
                  <div key={thread.key}>
                    <ThreadRow
                      thread={thread}
                      query={activeQuery}
                      index={threadIndex}
                      active={activeIndex === threadIndex}
                      onHighlight={() => setSelectedIndex(threadIndex)}
                      onOpen={() => openSelectable({ kind: "thread", thread })}
                    />
                    {thread.messages.map((message) => {
                      const index = model.selectables.findIndex(
                        (item) => item.kind === "message" && item.message.key === message.key,
                      );
                      const selectable = model.selectables[index];
                      if (!selectable || selectable.kind !== "message") return null;
                      return (
                        <MessageRow
                          key={message.key}
                          selectable={selectable}
                          query={activeQuery}
                          index={index}
                          active={activeIndex === index}
                          onHighlight={() => setSelectedIndex(index)}
                          onOpen={() => openSelectable(selectable)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </ScrollArea>
    );
  }

  return (
    <CommandPaletteContent
      aria-label="Search threads and messages"
      escapeLabel="Back"
      footerActionLabel="Open"
      inputProps={{
        placeholder: `Search ${threads.length === 1 ? "1 thread" : `${threads.length} threads`}`,
        onKeyDown: (event) => {
          if (event.key === "ArrowDown" && model.selectables.length > 0) {
            event.preventDefault();
            setSelectedIndex((current) => (current + 1) % model.selectables.length);
          } else if (event.key === "ArrowUp" && model.selectables.length > 0) {
            event.preventDefault();
            setSelectedIndex(
              (current) => (current - 1 + model.selectables.length) % model.selectables.length,
            );
          } else if (event.key === "Enter" && active) {
            // Matches for the previous query stay out of the list while a newer
            // query is debouncing or in flight, so Enter only opens what is shown.
            event.preventDefault();
            openSelectable(active);
          }
        },
      }}
      mode="none"
      onValueChange={setQuery}
      panelClassName="flex min-h-0 flex-1 flex-col"
      testId="thread-search"
      value={query}
    >
      <StatusLine text={status.text} tone={status.tone} pending={search.isPending && hasQuery} />
      {body}
    </CommandPaletteContent>
  );
}
