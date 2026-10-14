/* agent-watermark: model=haiku-5.5; effort=high; duration=40m; seat=claude-code; date=2026-10-13 */
import type {
  EnvironmentId,
  ProjectId,
  ThreadId,
  ThreadPullRequestLink,
  TurnId,
} from "@t3tools/contracts";
import type { UsageProviderKind } from "@t3tools/contracts";
import type { ProjectUsageSummary } from "@t3tools/shared/usageProjects";
import { describe, expect, it } from "vite-plus/test";

import type { SidebarThreadSummary } from "../../types";
import {
  bucketProjectThreads,
  findProjectUsage,
  summarizeProjectPullRequests,
  summarizeProjectRecaps,
  summarizeProjectWorkspaces,
} from "./projectHome.logic";

/*
 * Fixtures copy the shapes of the rows in a real scratch snapshot of the
 * server database (projection_threads, projection_turns, projection_projects),
 * taken 2026-10-13. Ids, titles, timestamps and model selections are verbatim.
 * Fields the snapshot does not carry (pull request links, pending counts for
 * a running session, archived rows) are built to the same contract shape and
 * say so where they appear.
 */

const LOCAL = "env-local" as EnvironmentId;
const MYLIFEOS_PROJECT = "6491d2c0-2d27-4234-9155-a94c10605846" as ProjectId;
const SERVER_PROJECT = "2f34ad82-c1bf-4367-b627-dfcb8dc3979e" as ProjectId;
const NOW = "2026-10-13T12:00:00.000Z";
const MODEL = { instanceId: "antigravity", model: "gemini-3.8-flash-high" } as never;

function shell(
  overrides: Omit<Partial<SidebarThreadSummary>, "id"> & { readonly id: string },
): SidebarThreadSummary {
  const { id, ...rest } = overrides;
  return {
    id: id as ThreadId,
    projectId: MYLIFEOS_PROJECT,
    environmentId: LOCAL,
    title: "Untitled",
    modelSelection: MODEL,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    latestTurnRecap: null,
    createdAt: "2026-10-03T18:56:17.017Z",
    updatedAt: "2026-10-03T18:56:17.017Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...rest,
  } as SidebarThreadSummary;
}

// Real rows: projection_threads for the MyLifeOS project, settled threads.
const settledOne = shell({
  id: "1d24d84b-cb42-421a-8e09-1adec21b2394",
  title: "$make-ultimate I want you to continue bu",
  branch: null,
  createdAt: "2026-10-03T18:56:17.017Z",
  updatedAt: "2026-10-06T18:57:01.045Z",
  latestUserMessageAt: "2026-10-03T18:56:17.017Z",
  settledOverride: "settled",
  settledAt: "2026-10-03T18:56:21.713Z",
});
const settledTwo = shell({
  id: "c024af79-2c23-4099-a835-0f914b646415",
  title: "Products to enterprise v1",
  branch: "main",
  createdAt: "2026-10-09T18:58:29.200Z",
  updatedAt: "2026-10-09T20:32:28.113Z",
  latestUserMessageAt: "2026-10-09T20:29:04.257Z",
  settledOverride: "settled",
  settledAt: "2026-10-09T20:32:28.099Z",
});
const settledThree = shell({
  id: "d1443945-34e3-4ef4-8e98-f1016c33f063",
  title: "Make projects ultimate and premium",
  branch: "main",
  createdAt: "2026-10-09T20:32:32.072Z",
  updatedAt: "2026-10-09T20:51:46.485Z",
  latestUserMessageAt: "2026-10-09T20:43:28.273Z",
  settledOverride: "settled",
  settledAt: "2026-10-09T20:51:46.456Z",
});
// Real row: the server project's only thread, active and not started.
const freshServerThread = shell({
  id: "cdccf1f2-b239-417d-aaa3-b8b55229b4f8",
  projectId: SERVER_PROJECT,
  title: "New thread",
  createdAt: "2026-10-14T01:25:56.773Z",
  updatedAt: "2026-10-14T01:25:56.773Z",
  modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" } as never,
});

const keyOf = (thread: SidebarThreadSummary) => `${thread.environmentId}:${thread.id}`;
const bucketInput = {
  now: NOW,
  lastVisitedAtByKey: {},
  threadKeyOf: keyOf,
} as const;

describe("bucketProjectThreads", () => {
  it("orders settled threads by when the work ended, newest first", () => {
    const buckets = bucketProjectThreads([settledOne, settledTwo, settledThree], bucketInput);
    expect(buckets.settled.map((thread) => thread.id)).toEqual([
      settledThree.id,
      settledTwo.id,
      settledOne.id,
    ]);
    expect(buckets.running).toHaveLength(0);
    expect(buckets.needsYou).toHaveLength(0);
  });

  it("puts a thread that has not run yet in the open bucket", () => {
    const buckets = bucketProjectThreads([freshServerThread], bucketInput);
    expect(buckets.open.map((thread) => thread.id)).toEqual([freshServerThread.id]);
    expect(buckets.settled).toHaveLength(0);
  });

  it("classifies a running session as running, using the sidebar's Working rule", () => {
    const working = shell({
      id: "11111111-1111-4111-8111-111111111111",
      projectId: SERVER_PROJECT,
      session: {
        threadId: "11111111-1111-4111-8111-111111111111",
        status: "running",
        providerName: "codex",
        providerInstanceId: "codex",
        runtimeMode: "full-access",
        activeTurnId: "22222222-2222-4222-8222-222222222222" as TurnId,
        lastError: null,
        updatedAt: NOW,
      } as never,
    });
    const buckets = bucketProjectThreads([working, freshServerThread], bucketInput);
    expect(buckets.running.map((thread) => thread.id)).toEqual([working.id]);
    expect(buckets.open.map((thread) => thread.id)).toEqual([freshServerThread.id]);
  });

  it("puts a pending approval in needs you", () => {
    const approval = shell({
      id: "33333333-3333-4333-8333-333333333333",
      projectId: SERVER_PROJECT,
      hasPendingApprovals: true,
    });
    const buckets = bucketProjectThreads([approval], bucketInput);
    expect(buckets.needsYou.map((thread) => thread.id)).toEqual([approval.id]);
  });

  it("keeps a snoozed thread in open rather than settled or running", () => {
    const snoozed = shell({
      id: "44444444-4444-4444-8444-444444444444",
      projectId: SERVER_PROJECT,
      snoozedUntil: "2026-10-13T18:00:00.000Z",
      settledOverride: "settled",
      settledAt: "2026-10-09T20:51:46.456Z",
    });
    const buckets = bucketProjectThreads([snoozed], bucketInput);
    expect(buckets.open.map((thread) => thread.id)).toEqual([snoozed.id]);
    expect(buckets.settled).toHaveLength(0);
  });

  it("counts archived threads apart from live ones", () => {
    // Archived row: the snapshot holds none, so this is the real settled row with archivedAt set.
    const archived = { ...settledOne, archivedAt: "2026-10-10T10:00:00.000Z" };
    const buckets = bucketProjectThreads([archived, settledTwo], bucketInput);
    expect(buckets.archived.map((thread) => thread.id)).toEqual([settledOne.id]);
    expect(buckets.settled.map((thread) => thread.id)).toEqual([settledTwo.id]);
  });
});

describe("summarizeProjectWorkspaces", () => {
  it("lists each branch and worktree once, with the threads on it", () => {
    const onMain = [settledTwo, settledThree];
    const worktree = shell({
      id: "55555555-5555-4555-8555-555555555555",
      branch: "feat/project-home",
      worktreePath: "/Users/luca/.t3/worktrees/project-home",
      title: "Project home",
      latestUserMessageAt: "2026-10-13T11:00:00.000Z",
    });
    const archivedWorktree = {
      ...worktree,
      id: "66666666-6666-4666-8666-666666666666" as ThreadId,
      archivedAt: "2026-10-01T00:00:00.000Z",
    };
    const uses = summarizeProjectWorkspaces([...onMain, worktree, archivedWorktree, settledOne]);
    expect(uses.map((use) => use.branch)).toEqual(["feat/project-home", "main"]);
    const main = uses.find((use) => use.branch === "main");
    expect(main?.worktreePath).toBeNull();
    expect(main?.threads.map((thread) => thread.id)).toEqual([settledTwo.id, settledThree.id]);
    expect(uses.find((use) => use.branch === "feat/project-home")?.threads).toHaveLength(1);
  });
});

describe("summarizeProjectPullRequests", () => {
  const link = (
    number: number,
    overrides: Partial<ThreadPullRequestLink> = {},
  ): ThreadPullRequestLink =>
    ({
      host: "github.com",
      repository: "luca/mylifeos",
      number,
      url: `https://github.com/luca/mylifeos/pull/${number}`,
      source: "manual",
      linkedAt: "2026-10-09T20:00:00.000Z",
      snapshot: null,
      stack: null,
      ...overrides,
    }) as ThreadPullRequestLink;

  it("shows open work first, dedupes a PR linked from two threads, and hides stack tombstones", () => {
    const withPrs = [
      shell({
        id: "77777777-7777-4777-8777-777777777777",
        title: "Open PR thread",
        pullRequests: [
          link(12, {
            linkedAt: "2026-10-01T00:00:00.000Z",
            snapshot: {
              state: "open",
              title: "Project home",
              headBranch: "feat/project-home",
              baseBranch: "main",
              isDraft: true,
              updatedAt: null,
              syncedAt: NOW,
            } as never,
          }),
          link(13, { source: "stack-dismissed" }),
        ],
      }),
      shell({
        id: "88888888-8888-4888-8888-888888888888",
        title: "Same PR again",
        pullRequests: [link(12)],
      }),
      shell({
        id: "99999999-9999-4999-8999-999999999999",
        title: "Merged PR",
        pullRequests: [
          link(9, {
            linkedAt: "2026-10-09T21:00:00.000Z",
            snapshot: {
              state: "merged",
              title: "Ship enterprise v1",
              headBranch: "enterprise",
              baseBranch: "main",
              isDraft: false,
              updatedAt: null,
              syncedAt: NOW,
            } as never,
          }),
        ],
      }),
    ];
    const entries = summarizeProjectPullRequests(withPrs);
    expect(entries.map((entry) => entry.number)).toEqual([12, 9]);
    expect(entries[0]).toMatchObject({
      state: "open",
      isDraft: true,
      threadTitle: "Open PR thread",
    });
    expect(entries[1]).toMatchObject({ state: "merged", title: "Ship enterprise v1" });
  });

  it("returns nothing for a project with no linked PRs, instead of an empty placeholder row", () => {
    expect(summarizeProjectPullRequests([settledOne, settledTwo, settledThree])).toEqual([]);
  });
});

describe("summarizeProjectRecaps", () => {
  it("reads the real settled turn's checkpoint totals, and skips settled threads with no recap", () => {
    // Real turn 645f6b17 of "Products to enterprise v1": 22 checkpoint files, 719 added, 11 removed,
    // completed 4m 25s after it started (projection_turns, 2026-10-09).
    const recapped = shell({
      id: settledTwo.id,
      title: settledTwo.title,
      settledOverride: "settled",
      settledAt: settledTwo.settledAt,
      latestTurn: {
        turnId: "645f6b17-0387-4b11-9cde-d0072d232077" as TurnId,
        state: "completed",
        requestedAt: "2026-10-09T18:58:29.200Z",
        startedAt: "2026-10-09T18:58:29.200Z",
        completedAt: "2026-10-09T19:02:54.043Z",
        assistantMessageId: null,
      } as never,
      latestTurnRecap: {
        turnId: "645f6b17-0387-4b11-9cde-d0072d232077" as TurnId,
        fileCount: 22,
        additions: 719,
        deletions: 11,
        failedCommandCount: 0,
      } as never,
    });
    const unrecapped = shell({ ...settledOne, settledAt: settledOne.settledAt });
    const recaps = summarizeProjectRecaps([recapped, unrecapped, settledThree]);
    expect(recaps).toHaveLength(1);
    expect(recaps[0]?.recap).toMatchObject({
      filesLabel: "22 files",
      additions: 719,
      deletions: 11,
      failedCommandCount: 0,
    });
    expect(recaps[0]?.recap.durationLabel).not.toBeNull();
  });
});

describe("findProjectUsage", () => {
  const usage = (
    projectPath: string | null,
    name: string,
  ): ProjectUsageSummary["projects"][number] => ({
    key: projectPath ?? `~${name}`,
    name,
    projectPath,
    costUsd: 1.5,
    totalTokens: 1000,
    sessions: 2,
    providers: ["claude" as UsageProviderKind],
    models: [],
    costShare: 0.5,
  });

  it("matches the usage row for this project's workspace root, ignoring a trailing slash", () => {
    const summary: ProjectUsageSummary = {
      partial: false,
      projects: [
        usage("/Users/luca/MyLifeOS/", "MyLifeOS"),
        usage("/Users/luca/MyLifeOS/Second-Brain/PROJECTS/t3code/apps/server", "server"),
        usage(null, "Unknown"),
      ],
    };
    expect(findProjectUsage(summary, "/Users/luca/MyLifeOS")?.name).toBe("MyLifeOS");
    expect(
      findProjectUsage(summary, "/Users/luca/MyLifeOS/Second-Brain/PROJECTS/t3code/apps/server/")
        ?.name,
    ).toBe("server");
    expect(findProjectUsage(summary, "/Users/luca/elsewhere")).toBeNull();
    expect(findProjectUsage({ partial: false, projects: [usage(null, "Unknown")] }, "")).toBeNull();
  });
});
