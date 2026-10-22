/* agent-watermark: model=opus-5.5; effort=high; duration=6m; seat=claude-code; date=2026-10-19 */
import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { combineEntrantChanges } from "./raceArena.logic";
import { buildRaceRecordInput } from "./raceRecord.logic";

const DIFF = [
  "diff --git a/src/cli.js b/src/cli.js",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/cli.js",
  "@@ -0,0 +1,2 @@",
  "+export const a = 1;",
  "+export const b = 2;",
].join("\n");

const base = {
  raceId: "k3f9a2",
  projectId: ProjectId.make("project-1"),
  projectTitle: "tally",
  titleSeed: "Add a --json flag",
  prompt: "Add a --json flag to the CLI. Add tests too.",
  startedAt: "2026-10-19T08:00:00.000Z",
  judge: null,
  entrants: [
    {
      slot: 1,
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      model: "claude-haiku-5-5",
      label: "Claude Haiku 5.5",
      phase: "finished" as const,
      elapsedMs: 24_400.6,
      changes: combineEntrantChanges({ committed: "", uncommitted: DIFF }),
      costUsd: 0.051,
      failure: null,
    },
    {
      slot: 2,
      instanceId: "codex",
      driver: "codex",
      model: "gpt-6.1-sol",
      label: "Codex GPT-6.1-Sol",
      phase: "failed" as const,
      elapsedMs: null,
      changes: null,
      costUsd: null,
      failure: "Codex usage limit reached.",
    },
  ],
};

describe("buildRaceRecordInput", () => {
  it("summarises each entrant's real diff and keeps failures and missing costs as they are", () => {
    const input = buildRaceRecordInput({ ...base, outcome: "kept", keptSlot: 1 });
    expect(input.entrants).toEqual([
      expect.objectContaining({ slot: 1, files: 1, additions: 2, deletions: 0, elapsedMs: 24_401 }),
      expect.objectContaining({
        slot: 2,
        files: 0,
        costUsd: null,
        elapsedMs: null,
        failure: "Codex usage limit reached.",
      }),
    ]);
    expect([input.outcome, input.keptSlot]).toEqual(["kept", 1]);
  });

  it("guesses the kind from the prompt unless the user picked one", () => {
    expect(buildRaceRecordInput({ ...base, outcome: "open", keptSlot: null })).toMatchObject({
      taskKind: "feature",
      taskKindSource: "guessed",
    });
    expect(
      buildRaceRecordInput({ ...base, outcome: "open", keptSlot: null, taskKind: "tests" }),
    ).toMatchObject({ taskKind: "tests", taskKindSource: "user" });
  });

  it("drops a kept slot when the race was not kept", () => {
    expect(buildRaceRecordInput({ ...base, outcome: "none", keptSlot: 1 }).keptSlot).toBeNull();
  });
});
