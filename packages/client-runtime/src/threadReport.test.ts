// @effect-diagnostics globalDate:off -- Tests pin generatedAt with fixed Date values.
/* agent-watermark: model=opus-5.5; effort=high; duration=5m; seat=claude-code; date=2026-10-09 */
/* agent-watermark: model=gemini-4-argon; effort=medium; duration=8m; seat=antigravity; date=2026-10-16 */
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadHandoffBundle,
  buildThreadReport,
  formatThreadHandoffMarkdown,
  threadFileChanges,
  threadHandoffFilename,
  threadReportFilename,
  threadTurns,
} from "./threadReport.ts";

const at = (m: number) => `2026-10-09T10:${String(m).padStart(2, "0")}:00.000Z`;
const thread = {
  title: "Add a --json flag",
  modelSelection: { instanceId: "codex", model: "gpt-6.1" },
  branch: "feat/json",
  worktreePath: null,
  createdAt: at(0),
  updatedAt: at(9),
  messages: [
    {
      id: "m1",
      role: "user",
      text: "Add a --json flag to status",
      turnId: "t1",
      streaming: false,
      createdAt: at(0),
      updatedAt: at(0),
    },
    {
      id: "m2",
      role: "assistant",
      text: "Done: `status --json` prints the report.",
      turnId: "t1",
      streaming: false,
      createdAt: at(4),
      updatedAt: at(4),
    },
    {
      id: "m3",
      role: "user",
      text: "Now document it",
      turnId: "t2",
      streaming: false,
      createdAt: at(5),
      updatedAt: at(5),
    },
  ],
  activities: [
    {
      id: "a1",
      tone: "tool",
      kind: "command",
      summary: "pnpm vitest run status",
      payload: null,
      turnId: "t1",
      createdAt: at(2),
    },
    {
      id: "a2",
      tone: "error",
      kind: "error",
      summary: "Provider stopped: usage limit",
      payload: null,
      turnId: "t2",
      createdAt: at(9),
    },
  ],
  checkpoints: [
    {
      turnId: "t1",
      checkpointTurnCount: 1,
      checkpointRef: "r1",
      status: "ready",
      files: [{ path: "src/status.ts", kind: "modified", additions: 12, deletions: 2 }],
      assistantMessageId: "m2",
      completedAt: at(4),
    },
    {
      turnId: "t2",
      checkpointTurnCount: 2,
      checkpointRef: "r2",
      status: "ready",
      files: [
        { path: "src/status.ts", kind: "modified", additions: 1, deletions: 0 },
        { path: "README.md", kind: "added", additions: 5, deletions: 0 },
      ],
      assistantMessageId: null,
      completedAt: at(9),
    },
  ],
  proposedPlans: [],
} as never;

describe("threadReport", () => {
  it("sums file changes across checkpoints per path", () => {
    expect(threadFileChanges((thread as { checkpoints: never }).checkpoints)).toEqual([
      { path: "README.md", kind: "added", additions: 5, deletions: 0 },
      { path: "src/status.ts", kind: "modified", additions: 13, deletions: 2 },
    ]);
  });

  it("groups messages and activities by turn", () => {
    const turns = threadTurns(thread);
    expect(
      turns.map(
        (t: { prompts: string[]; answers: string[]; tools: string[]; errors: string[] }) => [
          t.prompts.length,
          t.answers.length,
          t.tools.length,
          t.errors.length,
        ],
      ),
    ).toEqual([
      [1, 1, 1, 0],
      [1, 0, 0, 1],
    ]);
  });

  it("writes the full record and a PR description from the same facts", () => {
    const report = buildThreadReport({ thread, projectTitle: "lucacode" });
    expect(report).toContain("# Add a --json flag");
    expect(report).toContain("2 turns · 1 tool call · 2 files changed (+18 −2) · 1 error");
    expect(report).toContain("**Error:** Provider stopped: usage limit");
    expect(report).toContain("_No answer was recorded for this turn._");
    const pr = buildThreadReport({ thread, format: "pr" });
    expect(pr).toContain("Done: `status --json` prints the report.");
    expect(pr).toContain("- `src/status.ts` (modified, +13 −2)");
    expect(pr).toContain("- pnpm vitest run status");
  });

  it("names the file after the title", () => {
    expect(threadReportFilename("Add a --json flag!", "pr")).toBe("add-a-json-flag-pr.md");
    expect(threadHandoffFilename("Add a --json flag!", "json")).toBe(
      "add-a-json-flag-handoff.json",
    );
    expect(threadHandoffFilename("Add a --json flag!", "md")).toBe("add-a-json-flag-handoff.md");
  });

  it("computes blocked handoff bundle when latest turn has unresolved error", () => {
    const now = new Date("2026-10-16T12:00:00.000Z");
    const bundle = buildThreadHandoffBundle(thread, { projectTitle: "lucacode", now });
    expect(bundle.schemaVersion).toBe("t3.thread-handoff/1");
    expect(bundle.generatedAt).toBe("2026-10-16T12:00:00.000Z");
    expect(bundle.thread.projectTitle).toBe("lucacode");
    expect(bundle.thread.durationSeconds).toBe(540);
    expect(bundle.totals).toEqual({ filesChanged: 2, additions: 18, deletions: 2 });
    expect(bundle.verification).toEqual([
      {
        category: "test",
        command: "pnpm vitest run status",
        turnId: "t1",
        createdAt: at(2),
        outcome: "recorded",
      },
    ]);
    expect(bundle.blockers.unresolvedErrors).toEqual([
      {
        turnId: "t2",
        summary: "Provider stopped: usage limit",
        createdAt: at(9),
      },
    ]);
    expect(bundle.readiness.status).toBe("blocked");
    expect(bundle.readiness.score).toBeLessThan(50);
    expect(bundle.readiness.basis).toContain("2 turns");
  });

  it("computes needs_verification when files changed without verification commands", () => {
    const unverifiedThread = {
      ...(thread as Record<string, unknown>),
      activities: [
        {
          id: "a1",
          tone: "tool",
          kind: "command",
          summary: "git status",
          payload: null,
          turnId: "t1",
          createdAt: at(2),
        },
      ],
    } as never;
    const bundle = buildThreadHandoffBundle(unverifiedThread);
    expect(bundle.verification).toEqual([]);
    expect(bundle.blockers.unresolvedErrors).toEqual([]);
    expect(bundle.readiness.status).toBe("needs_verification");
    expect(bundle.readiness.score).toBeGreaterThanOrEqual(50);
    expect(bundle.readiness.score).toBeLessThan(80);
    expect(bundle.readiness.reasons[0]).toContain("with 0 verification commands recorded");
  });

  it("computes ready state and round-trips embedded JSON in handoff markdown", () => {
    const cleanThread = {
      ...(thread as Record<string, unknown>),
      activities: [
        {
          id: "a1",
          tone: "tool",
          kind: "command",
          summary: "pnpm typecheck",
          payload: null,
          turnId: "t1",
          createdAt: at(2),
        },
        {
          id: "a2",
          tone: "tool",
          kind: "command",
          summary: "pnpm vitest run status",
          payload: null,
          turnId: "t2",
          createdAt: at(8),
        },
      ],
    } as never;
    const bundle = buildThreadHandoffBundle(cleanThread, {
      projectTitle: "lucacode",
      now: new Date("2026-10-16T12:00:00.000Z"),
    });
    expect(bundle.readiness.status).toBe("ready");
    expect(bundle.readiness.score).toBe(100);
    expect(bundle.verification.map((v) => v.category)).toEqual(["typecheck", "test"]);

    const markdown = formatThreadHandoffMarkdown(bundle);
    expect(markdown).toContain("# Thread Handoff Receipt: Add a --json flag");
    expect(markdown).toContain("- **Readiness:** `READY` (100/100)");
    expect(markdown).toContain("- [x] `[typecheck]` `pnpm typecheck`");
    expect(markdown).toContain("- [x] `[test]` `pnpm vitest run status`");

    const jsonMatch = markdown.match(/```json\n([\s\S]+?)\n```/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(jsonMatch![1]!);
    expect(parsed).toEqual(bundle);
  });
});
