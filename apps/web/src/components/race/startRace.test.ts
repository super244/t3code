/* agent-watermark: model=opus-5.5; effort=high; duration=5m; seat=claude-code; date=2026-10-19 */
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import { parseRaceBranchName } from "@t3tools/shared/race";
import { describe, expect, it } from "vite-plus/test";

import { buildRaceStartTurns } from "./startRace";

const provider = (instanceId: string, displayName: string, model: string) =>
  ({
    instanceId,
    displayName,
    driver: instanceId,
    models: [{ slug: model, name: model, isDefault: true }],
  }) as unknown as ServerProvider;

describe("buildRaceStartTurns", () => {
  it("starts one worktree turn per entrant on its own race branch, from the chosen base", () => {
    let thread = 0;
    let message = 0;
    const turns = buildRaceStartTurns({
      environmentId: EnvironmentId.make("env-1"),
      projectId: ProjectId.make("project-1"),
      projectCwd: "/repo",
      baseBranch: "feature/cli",
      prompt: "  Add a --json flag  ",
      raceId: "k3f9a2",
      entrants: [
        { provider: provider("codex", "Codex", "gpt-6.1-sol"), model: "gpt-6.1-sol" },
        {
          provider: provider("claudeAgent", "Claude", "claude-haiku-5-5"),
          model: "claude-haiku-5-5",
        },
      ],
      createdAt: "2026-10-19T08:00:00.000Z",
      newThreadId: () => ThreadId.make(`thread-${++thread}`),
      newMessageId: () => MessageId.make(`message-${++message}`),
    });
    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => turn.input.message.text)).toEqual([
      "Add a --json flag",
      "Add a --json flag",
    ]);
    expect(
      turns.map((turn) => parseRaceBranchName(turn.input.bootstrap.prepareWorktree.branch)),
    ).toEqual([
      { raceId: "k3f9a2", slot: 1, count: 2 },
      { raceId: "k3f9a2", slot: 2, count: 2 },
    ]);
    expect(
      turns.every((turn) => turn.input.bootstrap.prepareWorktree.baseBranch === "feature/cli"),
    ).toBe(true);
    expect(turns[0]!.input.bootstrap.createThread.title).toBe(
      "Add a --json flag · Codex gpt-6.1-sol",
    );
    expect(new Set(turns.map((turn) => turn.input.threadId)).size).toBe(2);
  });
});

describe("buildRaceStartTurns for a rematch", () => {
  it("appends challengers after the race's slots, from the base commit, with their effort", () => {
    const withEffort = {
      ...provider("claudeAgent", "Claude", "claude-sonnet-5"),
      models: [
        {
          slug: "claude-sonnet-5",
          name: "Claude Sonnet 5",
          isDefault: true,
          capabilities: {
            optionDescriptors: [
              {
                id: "effort",
                label: "Reasoning effort",
                type: "select",
                options: [
                  { id: "low", label: "Low" },
                  { id: "high", label: "High", isDefault: true },
                ],
              },
            ],
          },
        },
      ],
    } as unknown as ServerProvider;
    let n = 0;
    const turns = buildRaceStartTurns({
      environmentId: EnvironmentId.make("env-1"),
      projectId: ProjectId.make("project-1"),
      projectCwd: "/repo",
      baseBranch: "0123456789abcdef0123456789abcdef01234567",
      prompt: "Add a --json flag",
      raceId: "k3f9a2",
      entrants: [{ provider: withEffort, model: "claude-sonnet-5", effort: "low" }],
      createdAt: "2026-10-19T08:00:00.000Z",
      newThreadId: () => ThreadId.make(`t-${++n}`),
      newMessageId: () => MessageId.make(`m-${n}`),
      append: { existingCount: 3 },
    });
    expect(parseRaceBranchName(turns[0]!.input.bootstrap.prepareWorktree.branch)).toEqual({
      raceId: "k3f9a2",
      slot: 4,
      count: 4,
    });
    expect(turns[0]!.input.bootstrap.prepareWorktree.baseBranch).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(turns[0]!.input.modelSelection.options).toEqual([{ id: "effort", value: "low" }]);
    expect(turns[0]!.input.bootstrap.createThread.title).toBe(
      "Add a --json flag · Claude Sonnet 5 · Low",
    );
  });
});
