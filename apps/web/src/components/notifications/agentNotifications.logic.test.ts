import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_AGENT_NOTIFICATION_PREFS,
  diffAgentShells,
  notificationText,
  shouldNotify,
  type AgentShellLike,
} from "./agentNotifications.logic";

const shell = (patch: Partial<AgentShellLike> = {}): AgentShellLike => ({
  key: "env:t1",
  title: "Fix the flaky test",
  archivedAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  session: { status: "ready", lastError: null },
  latestTurn: { turnId: "turn-1", state: "completed" },
  ...patch,
});

describe("diffAgentShells", () => {
  it("never notifies on the first observation", () => {
    const { events } = diffAgentShells(new Map(), [shell({ hasPendingApprovals: true })]);
    expect(events).toEqual([]);
  });

  it("reports a finished turn, an approval, a question and a failure once each", () => {
    const working = diffAgentShells(new Map(), [
      shell({ session: { status: "running" }, latestTurn: { turnId: "turn-2", state: "running" } }),
    ]).next;
    const finished = diffAgentShells(working, [
      shell({ latestTurn: { turnId: "turn-2", state: "completed" } }),
    ]);
    expect(finished.events.map((e) => e.kind)).toEqual(["finished"]);
    expect(diffAgentShells(finished.next, [shell()]).events).toEqual([]);

    const approval = diffAgentShells(working, [shell({ hasPendingApprovals: true })]);
    expect(approval.events.map((e) => e.kind)).toEqual(["approval"]);
    const input = diffAgentShells(working, [shell({ hasPendingUserInput: true })]);
    expect(input.events.map((e) => e.kind)).toEqual(["input"]);
    const failed = diffAgentShells(working, [
      shell({
        session: { status: "error", lastError: "usage limit reached" },
        latestTurn: { turnId: "turn-2", state: "error" },
      }),
    ]);
    expect(failed.events[0]).toMatchObject({ kind: "failed", detail: "usage limit reached" });
  });

  it("ignores archived threads and an interrupted turn", () => {
    const working = diffAgentShells(new Map(), [shell({ session: { status: "running" } })]).next;
    expect(
      diffAgentShells(working, [shell({ latestTurn: { turnId: "turn-1", state: "interrupted" } })])
        .events,
    ).toEqual([]);
    expect(
      diffAgentShells(working, [
        shell({ archivedAt: "2026-10-11T00:00:00Z", hasPendingApprovals: true }),
      ]).events,
    ).toEqual([]);
  });
});

describe("preferences and text", () => {
  it("respects the master switch and per-kind switches", () => {
    const event = { key: "k", kind: "finished" as const, title: "t", detail: null };
    expect(shouldNotify(event, DEFAULT_AGENT_NOTIFICATION_PREFS)).toBe(false);
    expect(shouldNotify(event, { ...DEFAULT_AGENT_NOTIFICATION_PREFS, enabled: true })).toBe(true);
    expect(
      shouldNotify(event, { ...DEFAULT_AGENT_NOTIFICATION_PREFS, enabled: true, finished: false }),
    ).toBe(false);
  });

  it("names the project and trims the error", () => {
    const text = notificationText(
      { key: "k", kind: "failed", title: "Ship it", detail: "x".repeat(400) },
      "t3code",
    );
    expect(text.title).toBe("Failed · t3code");
    expect(text.body.split("\n")[1]).toHaveLength(160);
  });
});
