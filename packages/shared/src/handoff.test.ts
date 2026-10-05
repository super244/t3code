/* agent-watermark: model=opus-5.5; effort=high; duration=40m; seat=claude-code; date=2026-10-05 */
import { describe, expect, it } from "vite-plus/test";

import {
  buildHandoffBrief,
  buildHandoffTitle,
  findHandoffsFrom,
  HANDOFF_BRIEF_MAX_CHARS,
  parseHandoffSource,
} from "./handoff.ts";

const base = {
  sourceThreadId: "thread-abc",
  sourceTitle: "Fix login redirect",
  sourceAgentLabel: "Claude · Sonnet 5.5",
};

describe("handoff brief", () => {
  it("carries the request, checkout state, failure and next step, and names its source", () => {
    const brief = buildHandoffBrief({
      ...base,
      messages: [
        { role: "user", text: "Fix the login redirect loop on /settings." },
        { role: "assistant", text: "I traced it to the auth guard." },
        { role: "user", text: "Also keep the query string." },
        { role: "assistant", text: "Patched guard.ts; tests still running." },
      ],
      latestPlan: "1. Patch guard\n2. Add test",
      changedFiles: [{ path: "src/guard.ts", insertions: 12, deletions: 3 }],
      branch: "t3code/fix-login",
      worktreePath: "/work/fix-login",
      lastError: "Usage limit reached for Claude.",
      note: null,
    });

    expect(parseHandoffSource(brief)).toBe("thread-abc");
    expect(brief).toContain("## Original request\n> Fix the login redirect loop on /settings.");
    expect(brief).toContain("## Latest plan");
    expect(brief).toContain("**User:** Also keep the query string.");
    expect(brief).toContain("- `src/guard.ts` +12 −3");
    expect(brief).toContain("branch `t3code/fix-login`");
    expect(brief).toContain("failed with: Usage limit reached for Claude.");
    // The last assistant message appears once, under "Where it stopped".
    expect(brief.match(/Patched guard\.ts/g)).toHaveLength(1);
    expect(brief).toContain("## Your next step\nReview the current state");
  });

  it("drops the oldest conversation first to stay under the cap", () => {
    const messages = Array.from({ length: 60 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `message ${index} ${"x".repeat(900)}`,
    }));
    const brief = buildHandoffBrief({ ...base, messages, note: "Only finish the tests." });
    expect(brief.length).toBeLessThanOrEqual(HANDOFF_BRIEF_MAX_CHARS);
    expect(brief).toContain("message 0 ");
    expect(brief).toContain("message 58 ");
    expect(brief).toMatch(/\(\d+ earlier messages omitted\)/);
    expect(brief).not.toContain("**User:** message 2 ");
    expect(brief.endsWith("Only finish the tests.")).toBe(true);
  });

  it("carries a chained handoff's original request instead of nesting the old brief", () => {
    const first = buildHandoffBrief({
      ...base,
      messages: [{ role: "user", text: "Fix the login redirect loop." }],
      lastError: "Codex usage limit reached.",
    });
    const second = buildHandoffBrief({
      ...base,
      sourceThreadId: "thread-def",
      messages: [
        { role: "user", text: first },
        { role: "assistant", text: "Fixed the guard." },
      ],
    });
    expect(parseHandoffSource(second)).toBe("thread-def");
    expect(second).toContain(
      "## Original request\n(This task has already been handed off before.)\n> Fix the login redirect loop.",
    );
    expect(second).not.toContain("> >");
    expect(second).not.toContain("Codex usage limit reached.");

    const third = buildHandoffBrief({
      ...base,
      sourceThreadId: "thread-ghi",
      messages: [{ role: "user", text: second }],
    });
    expect(third.match(/already been handed off/g)).toHaveLength(1);
    expect(third).toContain("> Fix the login redirect loop.");
  });

  it("unwraps briefs that quoted a whole earlier brief", () => {
    const legacy = [
      "[Handoff from thread new]",
      "",
      "## Original request",
      "> [Handoff from thread old]",
      ">",
      "> ## Original request",
      "> > Add subtract to calc.py.",
      ">",
      "> ## Your next step",
      "> Finish it.",
      "",
      "## Your next step",
      "Finish it.",
    ].join("\n");
    const brief = buildHandoffBrief({ ...base, messages: [{ role: "user", text: legacy }] });
    expect(brief).toContain(
      "## Original request\n(This task has already been handed off before.)\n> Add subtract to calc.py.\n",
    );
  });

  it("does not call an unread checkout clean", () => {
    const brief = buildHandoffBrief({
      ...base,
      messages: [{ role: "user", text: "Go." }],
      changedFiles: null,
    });
    expect(brief).not.toContain("No uncommitted changes");
    expect(brief).toContain("Check `git status` and `git diff`");
  });

  it("states an empty checkout instead of listing nothing", () => {
    const brief = buildHandoffBrief({
      ...base,
      messages: [{ role: "user", text: "Plan it." }],
      changedFiles: [],
    });
    expect(brief).toContain("No uncommitted changes.");
    expect(brief).toContain("It had not replied yet.");
  });
});

describe("handoff links", () => {
  const source = {
    id: "a",
    environmentId: "env",
    projectId: "p",
    title: "Fix login redirect",
    worktreePath: "/work/fix-login",
    createdAt: "2026-10-05T10:00:00.000Z",
  };

  it("does not stack the prefix when handing off a handoff", () => {
    expect(buildHandoffTitle("Fix login redirect")).toBe("↪ Fix login redirect");
    expect(buildHandoffTitle("↪ Fix login redirect")).toBe("↪ Fix login redirect");
  });

  it("finds continuations in the same checkout only", () => {
    const threads = [
      { ...source, id: "b", title: "↪ Fix login redirect", createdAt: "2026-10-05T11:00:00.000Z" },
      {
        ...source,
        id: "c",
        title: "↪ Fix login redirect",
        worktreePath: "/elsewhere",
        createdAt: "2026-10-05T11:00:00.000Z",
      },
      {
        ...source,
        id: "d",
        title: "↪ Fix login redirect",
        projectId: "q",
        createdAt: "2026-10-05T11:00:00.000Z",
      },
      { ...source, id: "e", title: "Fix login redirect", createdAt: "2026-10-05T11:00:00.000Z" },
      {
        ...source,
        id: "f",
        title: "↪ Fix login redirect",
        archivedAt: "2026-10-05T12:00:00.000Z",
        createdAt: "2026-10-05T11:30:00.000Z",
      },
    ];
    expect(findHandoffsFrom(source, threads).map((thread) => thread.id)).toEqual(["b"]);
  });

  it("only reads a marker at the start of the message", () => {
    expect(parseHandoffSource("  [Handoff from thread t-1]\n\nYou are")).toBe("t-1");
    expect(parseHandoffSource("Please see [Handoff from thread t-1]")).toBeNull();
    expect(parseHandoffSource(null)).toBeNull();
  });
});
