/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=7m; seat=codex; date=2026-10-15 */
import { describe, expect, it } from "@effect/vitest";
import { decodeUsageHistory, mergeUsageHistoryRecords, usageHistoryRoot } from "./usageHistory.ts";
import { encodeScanCache, type ScanCache } from "./usageScanCache.ts";
import { parseClaudeLine, type UsageRecord } from "./usageTranscripts.ts";

function record(id: string, output: number): UsageRecord {
  return parseClaudeLine(
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-08-01T10:00:00Z",
      sessionId: "s",
      message: {
        id,
        model: "claude-test",
        usage: { input_tokens: 10, output_tokens: output },
      },
    }),
  )!;
}

describe("retained usage history", () => {
  it("retains every recorded Claude row while keeping repeated scans idempotent", () => {
    const first = record("same", 12);
    const second = record("same", 8);
    const rows = [first, second, second];
    const merged = mergeUsageHistoryRecords([first], rows);
    expect(merged).toHaveLength(3);
    expect(merged.reduce((n, r) => n + r.totals.outputTokens, 0)).toBe(28);
    expect(mergeUsageHistoryRecords(merged, rows)).toEqual(merged);
  });

  it("preserves separate anonymous requests with identical counters", () => {
    const anonymous = { ...record("a", 7), dedupeKey: null };
    const merged = mergeUsageHistoryRecords([anonymous, anonymous], [anonymous]);
    expect(merged).toHaveLength(2);
    const restored = Object.fromEntries(
      Object.entries(anonymous).toReversed(),
    ) as unknown as UsageRecord;
    expect(mergeUsageHistoryRecords(merged, [restored, restored])).toHaveLength(2);
    expect(mergeUsageHistoryRecords(merged, [{ ...restored, reportedCostUsd: 0.25 }])).toHaveLength(
      2,
    );
  });

  it("migrates the known legacy cache layout and provider identity without accepting foreign versions", () => {
    const cache: ScanCache = new Map([
      [
        "/home/claude/projects/a/s.jsonl",
        {
          provider: "claude",
          size: 100,
          mtimeMs: 100,
          records: [record("msg_a", 12)],
          tailRecords: [],
          position: { resumeOffset: 100, guardLength: 0, guardHash: 0, codexState: null },
        },
      ],
    ]);
    const encoded = encodeScanCache(cache);
    const old = {
      ...encoded,
      version: 5,
      files: Object.fromEntries(
        Object.entries(encoded.files).map(([path, file]) => [
          path,
          {
            ...file,
            r: file.r.map((row) => [...row.slice(0, 8), "msg_a:req_a", ...row.slice(9, 11)]),
          },
        ]),
      ),
    };
    const decoded = decodeUsageHistory(old);
    expect(decoded.get("/home/claude/projects/a/s.jsonl")?.records[0]?.dedupeKey).toBe(
      record("msg_a", 12).dedupeKey,
    );
    expect(decodeUsageHistory({ ...old, version: 99 }).size).toBe(0);
    expect(decodeUsageHistory({ ...encoded, historyVersion: 1 }).size).toBe(1);
  });

  it("excludes local synthetic placeholders when recovering older evidence", () => {
    const synthetic = { ...record("local", 0), model: "<synthetic>" };
    const cache: ScanCache = new Map([
      [
        "/home/claude/projects/a/s.jsonl",
        {
          provider: "claude",
          size: 100,
          mtimeMs: 100,
          records: [synthetic, record("real", 4)],
          tailRecords: [],
          position: { resumeOffset: 100, guardLength: 0, guardHash: 0, codexState: null },
        },
      ],
    ]);
    expect(
      decodeUsageHistory({ ...encodeScanCache(cache), historyVersion: 1 }).get(
        "/home/claude/projects/a/s.jsonl",
      )?.records,
    ).toEqual([record("real", 4)]);
  });

  it("recovers stable roots for live, archived and removed transcript folders", () => {
    expect(usageHistoryRoot("/home/codex/archived_sessions/a.jsonl")).toBe(
      "/home/codex/archived_sessions",
    );
    expect(usageHistoryRoot("/home/claude/projects/project/a.jsonl")).toBe("/home/claude/projects");
  });
});
