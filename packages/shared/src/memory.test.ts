/* agent-watermark: model=opus-5.5; effort=high; duration=5m; seat=claude-code; date=2026-10-22 */
import { ProjectId, ThreadId, type MemoryEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildMemoryBrief,
  MEMORY_BRIEF_MAX_CHARS,
  MEMORY_MAX_ENTRIES_PER_SCOPE,
  memoryForProject,
  saveMemoryEntry,
  searchMemory,
} from "./memory.ts";

const tally = ProjectId.make("project-tally");
const other = ProjectId.make("project-other");
let counter = 0;
const nextId = () => `m${++counter}`;

const save = (
  entries: ReadonlyArray<MemoryEntry>,
  text: string,
  overrides: Partial<Parameters<typeof saveMemoryEntry>[1]> = {},
  now = "2026-10-22T10:00:00.000Z",
) => {
  const outcome = saveMemoryEntry(
    entries,
    {
      scope: "project",
      projectId: tally,
      text,
      source: "agent",
      threadId: ThreadId.make("thread-1"),
      author: "claudeAgent · claude-haiku-5-5",
      ...overrides,
    },
    now,
    nextId,
  );
  if (outcome.kind !== "saved") throw new Error(outcome.kind);
  return outcome;
};

describe("saveMemoryEntry", () => {
  it("adds, then refreshes a repeated fact instead of duplicating it", () => {
    const first = save([], "Run tests with npm test.");
    const again = save(
      first.entries,
      "  run TESTS with npm   test. ",
      {},
      "2026-10-22T11:00:00.000Z",
    );
    expect(again.entries).toHaveLength(1);
    expect(again.entry.id).toBe(first.entry.id);
    expect(again.entry.updatedAt).toBe("2026-10-22T11:00:00.000Z");
    // The same text in another scope is a separate memory.
    expect(
      save(again.entries, "Run tests with npm test.", { scope: "global" }).entries,
    ).toHaveLength(2);
  });

  it("edits by id, and refuses an unknown id or project memory without a project", () => {
    const first = save([], "Use pnpm.");
    const edited = saveMemoryEntry(
      first.entries,
      {
        id: first.entry.id,
        scope: "global",
        projectId: tally,
        text: "Use bun.",
        source: "user",
        threadId: null,
        author: null,
      },
      "2026-10-22T12:00:00.000Z",
      nextId,
    );
    expect(edited).toMatchObject({
      kind: "saved",
      entry: { text: "Use bun.", scope: "global", projectId: null },
    });
    expect(
      saveMemoryEntry(
        [],
        {
          id: "nope",
          scope: "global",
          projectId: null,
          text: "x",
          source: "user",
          threadId: null,
          author: null,
        },
        "t",
        nextId,
      ).kind,
    ).toBe("missing");
    expect(
      saveMemoryEntry(
        [],
        {
          scope: "project",
          projectId: null,
          text: "x",
          source: "user",
          threadId: null,
          author: null,
        },
        "t",
        nextId,
      ).kind,
    ).toBe("invalid");
  });

  it("drops the oldest entry of a full scope and leaves other scopes alone", () => {
    let entries: MemoryEntry[] = save([], "global fact", { scope: "global" }).entries;
    for (let index = 0; index < MEMORY_MAX_ENTRIES_PER_SCOPE; index += 1) {
      entries = save(
        entries,
        `fact ${index}`,
        {},
        `2026-10-22T10:${String(index % 60).padStart(2, "0")}:${String(Math.floor(index / 60)).padStart(2, "0")}.000Z`,
      ).entries;
    }
    const projectEntries = entries.filter((entry) => entry.scope === "project");
    expect(projectEntries).toHaveLength(MEMORY_MAX_ENTRIES_PER_SCOPE);
    expect(entries.some((entry) => entry.scope === "global")).toBe(true);
  });
});

describe("memoryForProject and searchMemory", () => {
  it("shows a project its own memory first, then global, never another project's", () => {
    let entries = save([], "tally uses node:test").entries;
    entries = save(entries, "other project fact", { projectId: other }).entries;
    entries = save(entries, "Luca prefers short replies", { scope: "global" }).entries;
    expect(memoryForProject(entries, tally).map((entry) => entry.text)).toEqual([
      "tally uses node:test",
      "Luca prefers short replies",
    ]);
    expect(searchMemory(memoryForProject(entries, tally), "SHORT luca").map((e) => e.text)).toEqual(
      ["Luca prefers short replies"],
    );
  });
});

describe("buildMemoryBrief", () => {
  it("is null with nothing to remember", () => {
    expect(buildMemoryBrief([], "tally")).toBeNull();
  });

  it("names the project, lists ids, and stays under its cap", () => {
    let entries: MemoryEntry[] = [];
    for (let index = 0; index < 60; index += 1) {
      entries = save(entries, `fact number ${index} ${"x".repeat(150)}`).entries;
    }
    const brief = buildMemoryBrief(memoryForProject(entries, tally), "tally")!;
    expect(brief.startsWith("<t3_memory>")).toBe(true);
    expect(brief).toContain('for the project "tally"');
    expect(brief.length).toBeLessThanOrEqual(MEMORY_BRIEF_MAX_CHARS + 120);
    expect(brief).toMatch(/older entries not shown; use `recall`/);
  });
});
