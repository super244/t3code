/* agent-watermark: model=haiku-5.5; effort=high; duration=27m; seat=claude-code; date=2026-10-12 */
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildLaunchpadModel,
  describeLaunchpadCounts,
  filterLaunchpadProjects,
  resolveLaunchpadThreadState,
  type LaunchpadProjectInput,
  type LaunchpadThreadInput,
} from "./NoActiveThreadState.logic";

const ENV = EnvironmentId.make("env-local");
const OTHER_ENV = EnvironmentId.make("env-remote");

function project(
  id: string,
  title: string,
  workspaceRoot: string,
  environmentId = ENV,
): LaunchpadProjectInput {
  return {
    id: ProjectId.make(id),
    environmentId,
    title,
    workspaceRoot,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function thread(
  id: string,
  projectId: string,
  overrides: Partial<LaunchpadThreadInput> = {},
): LaunchpadThreadInput {
  return {
    id: ThreadId.make(id),
    environmentId: ENV,
    projectId: ProjectId.make(projectId),
    title: `Thread ${id}`,
    branch: null,
    archivedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    session: null,
    latestTurn: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    latestUserMessageAt: null,
    ...overrides,
  };
}

describe("resolveLaunchpadThreadState", () => {
  it("names a pending decision above a running turn", () => {
    expect(
      resolveLaunchpadThreadState(
        thread("a", "p", {
          hasPendingApprovals: true,
          session: { status: "running" },
        }),
      ),
    ).toEqual({ label: "Needs approval", tone: "attention" });
    expect(resolveLaunchpadThreadState(thread("b", "p", { hasPendingUserInput: true }))).toEqual({
      label: "Needs input",
      tone: "attention",
    });
  });

  it("reads a running or starting session as working and an errored session as failed", () => {
    expect(
      resolveLaunchpadThreadState(thread("a", "p", { session: { status: "running" } })),
    ).toEqual({
      label: "Working",
      tone: "working",
    });
    expect(
      resolveLaunchpadThreadState(thread("b", "p", { session: { status: "starting" } })),
    ).toEqual({
      label: "Working",
      tone: "working",
    });
    expect(resolveLaunchpadThreadState(thread("c", "p", { session: { status: "error" } }))).toEqual(
      {
        label: "Failed",
        tone: "failed",
      },
    );
  });

  it("marks a settled thread with a failed last turn as failed, not ready", () => {
    expect(
      resolveLaunchpadThreadState(
        thread("a", "p", {
          session: { status: "ready" },
          latestTurn: { state: "error" },
        }),
      ),
    ).toEqual({ label: "Last turn failed", tone: "failed" });
  });

  it("says Not started for a thread with no session and no turn, and Ready otherwise", () => {
    expect(resolveLaunchpadThreadState(thread("a", "p"))).toEqual({
      label: "Not started",
      tone: "idle",
    });
    expect(
      resolveLaunchpadThreadState(
        thread("b", "p", { session: { status: "ready" }, latestTurn: { state: "completed" } }),
      ),
    ).toEqual({ label: "Ready", tone: "idle" });
  });

  it("does not call a thread with messages Not started when its session has ended", () => {
    expect(
      resolveLaunchpadThreadState(
        thread("a", "p", {
          latestUserMessageAt: "2026-10-05T00:00:00.000Z",
          session: { status: "stopped" },
          latestTurn: { state: "completed" },
        }),
      ),
    ).toEqual({ label: "Idle", tone: "idle" });
    expect(
      resolveLaunchpadThreadState(
        thread("b", "p", { latestUserMessageAt: "2026-10-05T00:00:00.000Z" }),
      ),
    ).toEqual({ label: "Idle", tone: "idle" });
  });
});

describe("buildLaunchpadModel", () => {
  const projects = [
    project("p-alpha", "Alpha", "/work/alpha"),
    project("p-beta", "Beta", "/work/beta"),
    project("p-empty", "Empty", "/work/empty"),
  ];

  it("lists recent threads across projects, most recent activity first, and drops archived ones", () => {
    const model = buildLaunchpadModel({
      projects,
      threads: [
        thread("old", "p-alpha", { updatedAt: "2026-10-02T00:00:00.000Z" }),
        thread("new", "p-beta", {
          updatedAt: "2026-10-05T00:00:00.000Z",
          branch: "feat/x",
        }),
        thread("archived", "p-alpha", {
          updatedAt: "2026-10-09T00:00:00.000Z",
          archivedAt: "2026-10-09T01:00:00.000Z",
        }),
      ],
    });

    expect(model.recentThreads.map((entry) => entry.threadId)).toEqual([
      ThreadId.make("new"),
      ThreadId.make("old"),
    ]);
    expect(model.recentThreads[0]).toMatchObject({
      projectTitle: "Beta",
      branch: "feat/x",
      state: { label: "Not started", tone: "idle" },
    });
    expect(model.activeThreadCount).toBe(2);
  });

  it("caps the recent list at the limit", () => {
    const model = buildLaunchpadModel({
      projects,
      recentLimit: 2,
      threads: ["a", "b", "c"].map((id, index) =>
        thread(id, "p-alpha", { updatedAt: `2026-10-0${index + 1}T00:00:00.000Z` }),
      ),
    });
    expect(model.recentThreads.map((entry) => entry.threadId)).toEqual([
      ThreadId.make("c"),
      ThreadId.make("b"),
    ]);
  });

  it("counts non-archived threads per project and separates the ones that need attention", () => {
    const model = buildLaunchpadModel({
      projects,
      threads: [
        thread("a1", "p-alpha", { session: { status: "running" } }),
        thread("a2", "p-alpha", { hasPendingApprovals: true }),
        thread("a3", "p-alpha"),
        thread("a4", "p-alpha", { archivedAt: "2026-10-09T01:00:00.000Z" }),
        thread("b1", "p-beta", { session: { status: "error" } }),
      ],
    });
    const byId = new Map(model.projects.map((entry) => [entry.projectId, entry] as const));

    expect(byId.get(ProjectId.make("p-alpha"))).toMatchObject({
      threadCount: 3,
      liveThreadCount: 2,
    });
    expect(byId.get(ProjectId.make("p-beta"))).toMatchObject({
      threadCount: 1,
      liveThreadCount: 0,
    });
    expect(byId.get(ProjectId.make("p-empty"))).toMatchObject({
      threadCount: 0,
      liveThreadCount: 0,
    });
  });

  it("names each project's folder from its workspace root", () => {
    const model = buildLaunchpadModel({ projects, threads: [] });
    expect(
      model.projects.find((entry) => entry.projectId === ProjectId.make("p-alpha")),
    ).toMatchObject({
      folder: "/work",
      workspaceRoot: "/work/alpha",
    });
  });

  it("keeps the same project id on two environments as two separate projects", () => {
    const model = buildLaunchpadModel({
      projects: [
        project("shared", "Local copy", "/a/shared"),
        project("shared", "Remote copy", "/b/shared", OTHER_ENV),
      ],
      threads: [thread("t", "shared", { environmentId: OTHER_ENV })],
    });
    expect(model.projects).toHaveLength(2);
    const remote = model.projects.find((entry) => entry.environmentId === OTHER_ENV);
    expect(remote).toMatchObject({ title: "Remote copy", threadCount: 1 });
    expect(model.recentThreads[0]?.projectTitle).toBe("Remote copy");
  });

  it("returns an honest empty model when there are no projects or threads", () => {
    const model = buildLaunchpadModel({ projects: [], threads: [] });
    expect(model).toEqual({ recentThreads: [], projects: [], activeThreadCount: 0 });
    expect(describeLaunchpadCounts(model)).toBe("0 threads across 0 projects");
  });
});

describe("filterLaunchpadProjects", () => {
  const model = buildLaunchpadModel({
    projects: [
      project("p-one", "Stores Ledger", "/code/ledger"),
      project("p-two", "Café Menu", "/code/cafe"),
    ],
    threads: [],
  });

  it("returns every project for a blank query", () => {
    expect(filterLaunchpadProjects(model.projects, "   ")).toHaveLength(2);
  });

  it("matches title, folder and path case- and accent-insensitively, with every token required", () => {
    expect(filterLaunchpadProjects(model.projects, "CAFE").map((entry) => entry.title)).toEqual([
      "Café Menu",
    ]);
    expect(
      filterLaunchpadProjects(model.projects, "code ledger").map((entry) => entry.title),
    ).toEqual(["Stores Ledger"]);
    expect(filterLaunchpadProjects(model.projects, "ledger menu")).toEqual([]);
  });
});

describe("describeLaunchpadCounts", () => {
  it("uses the singular form for exactly one", () => {
    const model = buildLaunchpadModel({
      projects: [project("p", "Only", "/x/only")],
      threads: [thread("t", "p")],
    });
    expect(describeLaunchpadCounts(model)).toBe("1 thread across 1 project");
  });
});
