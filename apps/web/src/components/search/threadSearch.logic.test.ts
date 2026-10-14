/* agent-watermark: model=haiku-5.5; effort=high; duration=65m; seat=claude-code; date=2026-10-13 */
import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";

import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import {
  buildThreadSearchModel,
  splitHighlightedText,
  threadSearchAuthorLabel,
  threadSearchStatus,
  threadTitleMatchesQuery,
  type ThreadSearchProject,
  type ThreadSearchThread,
} from "./threadSearch.logic";

// Shapes copied from a real developer vault (projection_threads, projection_projects,
// projection_thread_messages), not invented ones: UUID thread ids, "user:" and
// canonical "assistant:assistant:...:segment:N" message ids, ISO timestamps.
const env = EnvironmentId.make("env-local");
const projectId = ProjectId.make("c7a4b1d0-5e2f-4a8b-9c3d-2f1e0a9b8c7d");
const enterpriseThread = ThreadId.make("d1443945-34e3-4ef4-8e98-f1016c33f063");
const notesThread = ThreadId.make("c024af79-2c23-4099-a835-0f914b646415");
const freshThread = ThreadId.make("cdccf1f2-b239-417d-aaa3-b8b55229b4f8");
const realUserMessage = MessageId.make("user:0f6c1d2a-3b4c-4d5e-8f70-1a2b3c4d5e6f");
const realAssistantMessage = MessageId.make(
  "assistant:assistant:e8260b2c-ca47-4ef1-8b2c-903f788e6866:runtime:cb3b3a13-3947-4ec1-a1ef-d645426fc02b:segment:64",
);
const archivedAssistantMessage = MessageId.make(
  "assistant:assistant:7a9b0c1d-2e3f-4a5b-9c6d-7e8f9a0b1c2d:runtime:5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f80:segment:3",
);

const threads: ReadonlyArray<ThreadSearchThread> = [
  {
    environmentId: env,
    id: enterpriseThread,
    projectId,
    title: "Make projects ultimate and premium",
    archivedAt: null,
    updatedAt: "2026-10-09T20:51:46.485Z",
  },
  {
    environmentId: env,
    id: notesThread,
    projectId,
    title: "Products to enterprise v1",
    archivedAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-10-09T20:32:28.113Z",
  },
  {
    environmentId: env,
    id: freshThread,
    projectId,
    title: "New thread",
    archivedAt: null,
    updatedAt: "2026-10-13T01:25:56.773Z",
  },
];

const projects: ReadonlyArray<ThreadSearchProject> = [
  { environmentId: env, id: projectId, title: "MyLifeOS" },
];

const match = (
  threadId: ThreadId,
  messageId: MessageId,
  source: "user" | "assistant",
  snippet: string,
  messageCreatedAt: string,
): EnvironmentThreadSearchMatch => ({
  environmentId: env,
  threadId,
  projectId,
  messageId,
  source,
  snippet,
  messageCreatedAt,
});

describe("splitHighlightedText", () => {
  it("marks every case-insensitive occurrence and keeps the original casing", () => {
    expect(
      splitHighlightedText("Enterprise telemetry, then enterprise cockpit.", "enterprise"),
    ).toEqual([
      { text: "Enterprise", matched: true },
      { text: " telemetry, then ", matched: false },
      { text: "enterprise", matched: true },
      { text: " cockpit.", matched: false },
    ]);
  });

  it("returns the text unmarked when there is no query or no match", () => {
    expect(splitHighlightedText("plain text", "  ")).toEqual([
      { text: "plain text", matched: false },
    ]);
    expect(splitHighlightedText("plain text", "absent")).toEqual([
      { text: "plain text", matched: false },
    ]);
  });

  it("treats regex metacharacters in the query as literal text", () => {
    expect(splitHighlightedText("Literal 100% fix (v1.2)", "100% fix (v1.2)")).toEqual([
      { text: "Literal ", matched: false },
      { text: "100% fix (v1.2)", matched: true },
    ]);
  });
});

describe("threadTitleMatchesQuery", () => {
  it("matches every word of the query anywhere in the title", () => {
    expect(threadTitleMatchesQuery("Make projects ultimate and premium", "premium projects")).toBe(
      true,
    );
    expect(threadTitleMatchesQuery("Make projects ultimate and premium", "cockpit")).toBe(false);
  });
});

describe("threadSearchAuthorLabel", () => {
  it("labels user messages as You and everything else as Agent", () => {
    expect(threadSearchAuthorLabel("user")).toBe("You");
    expect(threadSearchAuthorLabel("assistant")).toBe("Agent");
  });
});

describe("buildThreadSearchModel", () => {
  it("groups message matches under their thread and project, newest message first", () => {
    const model = buildThreadSearchModel({
      query: "enterprise",
      threads,
      projects,
      matches: [
        match(
          enterpriseThread,
          realUserMessage,
          "user",
          "Make the enterprise telemetry ultimate and premium.",
          "2026-10-09T20:50:00.000Z",
        ),
        match(
          enterpriseThread,
          realAssistantMessage,
          "assistant",
          "I have completed all objectives for the enterprise v1 release.",
          "2026-10-09T20:51:11.000Z",
        ),
        match(
          notesThread,
          archivedAssistantMessage,
          "assistant",
          "An enterprise note from the archived planning thread.",
          "2026-09-01T00:00:05.000Z",
        ),
      ],
    });

    expect(model.projects.map((project) => project.title)).toEqual(["MyLifeOS"]);
    const [project] = model.projects;
    expect(project?.threads.map((thread) => thread.title)).toEqual([
      "Make projects ultimate and premium",
      "Products to enterprise v1",
    ]);
    expect(project?.threads[0]?.messages.map((message) => message.source)).toEqual([
      "assistant",
      "user",
    ]);
    expect(project?.threads[1]?.archived).toBe(true);
    expect(model.threadCount).toBe(2);
    expect(model.messageCount).toBe(3);
  });

  it("selects threads and messages in the order they are drawn, for keyboard navigation", () => {
    const model = buildThreadSearchModel({
      query: "enterprise",
      threads,
      projects,
      matches: [
        match(
          enterpriseThread,
          realUserMessage,
          "user",
          "Make the enterprise telemetry ultimate and premium.",
          "2026-10-09T20:50:00.000Z",
        ),
      ],
    });
    expect(
      model.selectables.map((item) =>
        item.kind === "thread"
          ? `thread:${item.thread.title}`
          : `message:${item.message.messageId}`,
      ),
    ).toEqual([
      "thread:Make projects ultimate and premium",
      `message:${realUserMessage}`,
      "thread:Products to enterprise v1",
    ]);
  });

  it("adds threads whose title matches even when no message does", () => {
    const model = buildThreadSearchModel({
      query: "premium projects",
      threads,
      projects,
      matches: [],
    });
    expect(model.threadCount).toBe(1);
    expect(model.messageCount).toBe(0);
    expect(model.projects[0]?.threads[0]).toMatchObject({
      title: "Make projects ultimate and premium",
      titleMatched: true,
      messages: [],
    });
  });

  it("keeps a match whose thread shell is not loaded, under a neutral title", () => {
    const model = buildThreadSearchModel({
      query: "enterprise",
      threads: [],
      projects,
      matches: [
        match(
          enterpriseThread,
          realUserMessage,
          "user",
          "Make the enterprise telemetry ultimate and premium.",
          "2026-10-09T20:50:00.000Z",
        ),
      ],
    });
    expect(model.messageCount).toBe(1);
    expect(model.projects[0]?.title).toBe("Unknown project");
    expect(model.projects[0]?.threads[0]?.title).toBe("Untitled thread");
  });

  it("returns an empty model for an empty result set", () => {
    const model = buildThreadSearchModel({ query: "nothing", threads, projects, matches: [] });
    expect(model).toEqual({ projects: [], selectables: [], threadCount: 0, messageCount: 0 });
  });
});

describe("threadSearchStatus", () => {
  const base = {
    query: "enterprise",
    searchableThreadCount: 3,
    isPending: false,
    threadCount: 2,
    messageCount: 3,
  };

  it("asks for two characters before searching", () => {
    expect(threadSearchStatus({ ...base, query: "e" }).text).toBe(
      "Type at least 2 characters to search 3 threads.",
    );
  });

  it("says how many threads are being searched while results are pending", () => {
    expect(threadSearchStatus({ ...base, isPending: true }).text).toBe("Searching 3 threads…");
  });

  it("reports threads and messages when there are results", () => {
    expect(threadSearchStatus(base)).toEqual({ tone: "muted", text: "2 threads · 3 messages" });
  });

  it("says what was searched when nothing matched, and what it covered", () => {
    const status = threadSearchStatus({ ...base, threadCount: 0, messageCount: 0 });
    expect(status.text).toBe("No matches in 3 threads.");
    expect(status.hint).toMatch(/including archived threads/);
  });

  it("is honest about having no threads to search at all", () => {
    expect(
      threadSearchStatus({ ...base, searchableThreadCount: 0, threadCount: 0, messageCount: 0 }),
    ).toEqual({ tone: "muted", text: "No threads to search yet." });
  });
});
