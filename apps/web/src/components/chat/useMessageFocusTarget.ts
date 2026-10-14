/* agent-watermark: model=haiku-5.5; effort=high; duration=65m; seat=claude-code; date=2026-10-13 */
import type { LegendListRef } from "@legendapp/list/react";
import type { TurnId } from "@t3tools/contracts";
import { useEffect, useRef, type RefObject } from "react";

import type { TimelineEntry } from "../../session-logic";
import { toastManager } from "../ui/toast";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import type { CitationHistoryPage } from "./useAssistantCitationTarget";

export const MESSAGE_FOCUS_FLASH_CLASS = "message-focus-flash";
export const MESSAGE_FOCUS_FLASH_MS = 1600;
/** Older pages are requested one at a time; this bounds a message that is not in the thread. */
const MAX_HISTORY_PAGES = 20;

export type MessageFocusStep =
  | { readonly kind: "scroll"; readonly index: number }
  | { readonly kind: "expand-turn"; readonly turnId: TurnId }
  | { readonly kind: "load-earlier" }
  | { readonly kind: "wait" }
  | { readonly kind: "unavailable" };

/**
 * Decides the next move toward a message the user asked to see (from search).
 * Rendered rows win; a message that is loaded but folded away needs its turn
 * expanded; anything older needs another history page. Waiting is the answer
 * whenever the thread has not finished loading, so a slow load is not reported
 * as a missing message.
 */
export function resolveMessageFocusStep(input: {
  readonly rowIndex: number;
  readonly entry: { readonly turnId: TurnId | null } | null;
  readonly entriesLoaded: boolean;
  readonly listReady: boolean;
  readonly history: CitationHistoryPage | null;
  readonly historyLoading: boolean;
  readonly requestedPages: number;
  readonly turnAlreadyExpanded: boolean;
}): MessageFocusStep {
  if (input.rowIndex >= 0) {
    return input.listReady ? { kind: "scroll", index: input.rowIndex } : { kind: "wait" };
  }
  if (input.entry !== null) {
    if (input.entry.turnId === null) return { kind: "unavailable" };
    if (input.turnAlreadyExpanded) return { kind: "wait" };
    return { kind: "expand-turn", turnId: input.entry.turnId };
  }
  if (!input.entriesLoaded || input.historyLoading) return { kind: "wait" };
  if (input.history !== null && input.requestedPages < MAX_HISTORY_PAGES) {
    return { kind: "load-earlier" };
  }
  return { kind: "unavailable" };
}

/** Flashes the row after it scrolls into view. Works on the DOM so rows never re-render. */
function flashMessageRow(messageId: string, framesLeft = 20): void {
  const row = document.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"][data-message-role]`,
  );
  if (!row) {
    if (framesLeft > 0) {
      requestAnimationFrame(() => flashMessageRow(messageId, framesLeft - 1));
    }
    return;
  }
  row.classList.add(MESSAGE_FOCUS_FLASH_CLASS);
  window.setTimeout(() => {
    row.classList.remove(MESSAGE_FOCUS_FLASH_CLASS);
  }, MESSAGE_FOCUS_FLASH_MS);
}

/**
 * Brings a message requested by id into view and flashes it once. `onHandled`
 * runs when the request is settled, so the caller can clear it from the URL and
 * a reload does not repeat the jump.
 */
export function useMessageFocusTarget({
  messageId,
  entries,
  rows,
  listRef,
  history,
  onExpandTurn,
  onManualNavigation,
  onHandled,
}: {
  messageId: string | null;
  entries: ReadonlyArray<TimelineEntry>;
  rows: ReadonlyArray<MessagesTimelineRow>;
  listRef: RefObject<LegendListRef | null>;
  history: CitationHistoryPage | null;
  onExpandTurn: (turnId: TurnId) => void;
  onManualNavigation: () => void;
  onHandled: () => void;
}) {
  const attemptRef = useRef<{
    messageId: string;
    requestedPages: number;
    expandedTurnIds: Set<TurnId>;
    settled: boolean;
  } | null>(null);

  useEffect(() => {
    if (messageId === null) {
      attemptRef.current = null;
      return;
    }
    if (attemptRef.current?.messageId !== messageId) {
      attemptRef.current = {
        messageId,
        requestedPages: 0,
        expandedTurnIds: new Set(),
        settled: false,
      };
    }
    const attempt = attemptRef.current;
    if (attempt.settled) return;

    const rowIndex = rows.findIndex(
      (row) => row.kind === "message" && row.message.id === messageId,
    );
    const entry = entries.find((item) => item.kind === "message" && item.message.id === messageId);
    const turnId = entry?.kind === "message" ? (entry.message.turnId ?? null) : null;
    const step = resolveMessageFocusStep({
      rowIndex,
      entry: entry ? { turnId } : null,
      entriesLoaded: entries.length > 0,
      listReady: listRef.current !== null,
      history,
      historyLoading: history?.loading ?? false,
      requestedPages: attempt.requestedPages,
      turnAlreadyExpanded: turnId !== null && attempt.expandedTurnIds.has(turnId),
    });

    if (step.kind === "scroll") {
      attempt.settled = true;
      onManualNavigation();
      void listRef.current
        ?.scrollToIndex({ index: step.index, animated: true, viewOffset: 120 })
        .then(() => flashMessageRow(messageId));
      onHandled();
    } else if (step.kind === "expand-turn") {
      attempt.expandedTurnIds.add(step.turnId);
      onExpandTurn(step.turnId);
    } else if (step.kind === "load-earlier" && history) {
      attempt.requestedPages += 1;
      history.onLoadEarlier();
    } else if (step.kind === "unavailable") {
      attempt.settled = true;
      toastManager.add({
        type: "warning",
        title: "That message is no longer in this thread",
        description: "It may have been removed. Search again to find a message that is still here.",
      });
      onHandled();
    }
  }, [entries, history, listRef, messageId, onExpandTurn, onHandled, onManualNavigation, rows]);
}
