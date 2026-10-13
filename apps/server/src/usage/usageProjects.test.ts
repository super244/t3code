/* agent-watermark: model=haiku-5.5; effort=high; duration=55m; seat=claude-code; date=2026-10-12 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { RateTable } from "./usagePricing.ts";
import {
  claudeProjectSlug,
  resolveClaudeProjectSlug,
  resolveTranscriptProjects,
  UsageProjectAggregator,
} from "./usageProjects.ts";
import { EMPTY_TOTALS, type UsageRecord } from "./usageTranscripts.ts";

const tree: Record<string, readonly string[]> = {
  "/": ["Users"],
  "/Users": ["luca"],
  "/Users/luca": ["MyLifeOS", "my.site"],
  "/Users/luca/MyLifeOS": ["Second-Brain", "AIos"],
  "/Users/luca/MyLifeOS/Second-Brain": ["PROJECTS"],
  "/Users/luca/MyLifeOS/Second-Brain/PROJECTS": ["network-tunnel", "network"],
  "/Users/luca/MyLifeOS/Second-Brain/PROJECTS/network": [],
};
const readDir = (path: string) => Effect.succeed(tree[path] ?? []);

const record = (sessionId: string, outputTokens: number): UsageRecord => ({
  provider: "claude",
  timestampMs: 0,
  model: "claude-test",
  sessionId,
  totals: { ...EMPTY_TOTALS, outputTokens },
  reportedCostUsd: null,
  dedupeKey: null,
});

describe("usage by project", () => {
  it.effect(
    "resolves a lossy Claude Code folder name against the filesystem, longest name first",
    () =>
      Effect.gen(function* () {
        const resolve = (slug: string) => resolveClaudeProjectSlug(slug, readDir);
        expect(yield* resolve("-Users-luca-MyLifeOS-Second-Brain-PROJECTS-network-tunnel")).toBe(
          "/Users/luca/MyLifeOS/Second-Brain/PROJECTS/network-tunnel",
        );
        expect(yield* resolve("-Users-luca-my-site")).toBe("/Users/luca/my.site");
        expect(yield* resolve("-Users-luca-Deleted-project")).toBeNull();
      }),
  );

  it.effect("attributes Claude transcripts by folder and leaves other providers unattributed", () =>
    Effect.gen(function* () {
      const root = "/Users/luca/.claude/projects";
      const slug = "-Users-luca-MyLifeOS-AIos";
      expect(claudeProjectSlug(root, `${root}/${slug}/abc.jsonl`)).toBe(slug);
      const projectOf = yield* resolveTranscriptProjects([slug], readDir);
      expect(projectOf("claude", root, `${root}/${slug}/abc.jsonl`)).toEqual({
        projectPath: "/Users/luca/MyLifeOS/AIos",
        name: "AIos",
      });
      expect(
        projectOf("codex", "/Users/luca/.codex/sessions", "/x/rollout.jsonl").projectPath,
      ).toBeNull();
    }),
  );

  it("totals tokens, cost and distinct sessions per project", () => {
    const rates: RateTable = new Map([
      [
        "claude-test",
        {
          inputCostPerToken: 0,
          outputCostPerToken: 1e-3,
          cacheReadCostPerToken: 0,
          cacheCreationCostPerToken: 0,
        },
      ],
    ]);
    const aggregator = new UsageProjectAggregator(rates);
    const aios = { projectPath: "/Users/luca/MyLifeOS/AIos", name: "AIos" };
    aggregator.add(aios, record("s1", 100));
    aggregator.add(aios, record("s1", 100));
    aggregator.add({ projectPath: null, name: "Not recorded" }, record("s2", 10));
    const [first, second] = aggregator.finish();
    expect(first).toMatchObject({ name: "AIos", records: 2, sessions: 1 });
    expect(first?.totals.outputTokens).toBe(200);
    expect(first?.costUsd).toBeCloseTo(0.2);
    expect(second?.name).toBe("Not recorded");
  });
});
