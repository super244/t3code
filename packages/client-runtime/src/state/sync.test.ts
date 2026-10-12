/* agent-watermark: model=muse-spark; effort=high; duration=35m; seat=opencode; date=2026-10-10 */
import { EnvironmentId, ProjectId, ThreadId, type OrchestrationThreadShell } from "@t3tools/contracts";
import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { BearerConnectionTarget, PrimaryConnectionTarget, RelayConnectionTarget } from "../connection/model.ts";
import {
  describeConnectionModeForTarget,
  partitionThreadsByShelf,
  summarizeEnvironmentSync,
  type MultiEnvThreadRef,
} from "./sync.ts";

const NOW = "2026-10-10T12:00:00.000Z";

function makeThread(overrides: Partial<OrchestrationThreadShell> = {}): OrchestrationThreadShell {
  return {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  } as OrchestrationThreadShell;
}

function ref(env: string, thread: OrchestrationThreadShell): MultiEnvThreadRef {
  return { environmentId: EnvironmentId.make(env), thread };
}

describe("partitionThreadsByShelf", () => {
  it("keeps snooze/unsnooze and close/reopen visible on their shelves", () => {
    const partitioned = partitionThreadsByShelf(
      [
        ref("env-a", makeThread({ id: ThreadId.make("inbox") })),
        ref("env-a", makeThread({ id: ThreadId.make("snoozed"), snoozedUntil: "2026-10-11T09:00:00.000Z" })),
        ref("env-b", makeThread({ id: ThreadId.make("closed"), archivedAt: "2026-10-10T09:00:00.000Z" })),
        ref("env-b", makeThread({ id: ThreadId.make("settled"), settledAt: "2026-10-10T08:00:00.000Z" })),
      ],
      { now: NOW },
    );
    expect(partitioned.inbox.map((entry) => entry.thread.id)).toEqual(["inbox"]);
    expect(partitioned.snoozed.map((entry) => entry.thread.id)).toEqual(["snoozed"]);
    expect(partitioned.archived.map((entry) => entry.thread.id)).toEqual(["closed"]);
    expect(partitioned.settled.map((entry) => entry.thread.id)).toEqual(["settled"]);
    // Multi-env keys survive the partition.
    expect(partitioned.archived[0]?.environmentId).toBe("env-b");
  });

  it("wakes timers back into the inbox with no event", () => {
    const partitioned = partitionThreadsByShelf(
      [ref("env-a", makeThread({ id: ThreadId.make("woke"), snoozedUntil: "2026-10-09T09:00:00.000Z" }))],
      { now: NOW },
    );
    expect(partitioned.inbox.map((entry) => entry.thread.id)).toEqual(["woke"]);
    expect(partitioned.snoozed).toEqual([]);
  });
});

describe("summarizeEnvironmentSync", () => {
  it("reports multi-env health", () => {
    expect(
      summarizeEnvironmentSync([
        { status: "live", updatedAt: NOW },
        { status: "synchronizing", updatedAt: null },
      ]),
    ).toEqual({
      total: 2,
      live: 1,
      synchronizing: 1,
      stale: 0,
      latestUpdatedAt: NOW,
    });
  });
});

describe("describeConnectionModeForTarget", () => {
  it("maps relay, remote, and loopback-local targets", () => {
    expect(
      describeConnectionModeForTarget(
        new RelayConnectionTarget({ environmentId: EnvironmentId.make("env-1"), label: "relay" }),
      ),
    ).toBe("relay");
    expect(
      describeConnectionModeForTarget(
        new BearerConnectionTarget({
          environmentId: EnvironmentId.make("env-1"),
          label: "remote",
          connectionId: "conn-1",
        }),
      ),
    ).toBe("remote");
    expect(
      describeConnectionModeForTarget(
        new PrimaryConnectionTarget({
          environmentId: EnvironmentId.make("env-1"),
          label: "local",
          httpBaseUrl: "http://localhost:3930/",
          wsBaseUrl: "ws://localhost:3930/",
        }),
      ),
    ).toBe("local");
  });
});
