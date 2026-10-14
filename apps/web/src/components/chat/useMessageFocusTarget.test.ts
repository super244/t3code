/* agent-watermark: model=haiku-5.5; effort=high; duration=65m; seat=claude-code; date=2026-10-13 */
import { describe, expect, it } from "vite-plus/test";
import { TurnId } from "@t3tools/contracts";

import { resolveMessageFocusStep, type MessageFocusStep } from "./useMessageFocusTarget";
import type { CitationHistoryPage } from "./useAssistantCitationTarget";

const turnId = TurnId.make("turn-e8260b2c-ca47-4ef1-8b2c");
const history: CitationHistoryPage = {
  loading: false,
  cursor: "assistant:assistant:e8260b2c-ca47-4ef1-8b2c-903f788e6866:runtime:cb3b3a13:segment:12",
  onLoadEarlier: () => undefined,
};

const base = {
  rowIndex: -1,
  entry: null,
  entriesLoaded: true,
  listReady: true,
  history: null,
  historyLoading: false,
  requestedPages: 0,
  turnAlreadyExpanded: false,
} as const;

function step(overrides: Partial<Parameters<typeof resolveMessageFocusStep>[0]>): MessageFocusStep {
  return resolveMessageFocusStep({ ...base, ...overrides });
}

describe("resolveMessageFocusStep", () => {
  it("scrolls to a rendered row once the list is ready", () => {
    expect(step({ rowIndex: 41 })).toEqual({ kind: "scroll", index: 41 });
  });

  it("waits for the list to mount instead of giving up on a rendered row", () => {
    expect(step({ rowIndex: 41, listReady: false })).toEqual({ kind: "wait" });
  });

  it("expands a loaded message whose turn is folded away", () => {
    expect(step({ entry: { turnId }, history })).toEqual({ kind: "expand-turn", turnId });
  });

  it("does not expand the same turn twice", () => {
    expect(step({ entry: { turnId }, turnAlreadyExpanded: true })).toEqual({ kind: "wait" });
  });

  it("treats a loaded message with no turn it can expand as unavailable", () => {
    expect(step({ entry: { turnId: null } })).toEqual({ kind: "unavailable" });
  });

  it("waits while the thread is still loading, so slow loads are not reported as missing", () => {
    expect(step({ entriesLoaded: false, history })).toEqual({ kind: "wait" });
    expect(step({ historyLoading: true, history: { ...history, loading: true } })).toEqual({
      kind: "wait",
    });
  });

  it("loads an older page when the message is outside the loaded window", () => {
    expect(step({ history })).toEqual({ kind: "load-earlier" });
  });

  it("gives up after a bounded number of history pages", () => {
    expect(step({ history, requestedPages: 20 })).toEqual({ kind: "unavailable" });
  });

  it("reports unavailable when the thread has no older history and no such message", () => {
    expect(step({ history: null })).toEqual({ kind: "unavailable" });
  });
});
