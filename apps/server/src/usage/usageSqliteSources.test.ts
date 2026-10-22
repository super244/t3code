/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=20m; seat=codex; date=2026-10-17 */
/* agent-watermark: model=grok-4.7; effort=default; duration=40m; seat=cursor; date=2026-09-30 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=2m; seat=antigravity; date=2026-10-02 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { describe, expect, it } from "@effect/vitest";

import { readSqliteUsageRecords } from "./usageSqliteSources.ts";

const WHEN = Date.parse("2026-08-01T10:00:00.000Z");

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 127) {
    bytes.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest & 0x7f);
  return Buffer.from(bytes);
}

function fieldVarint(field: number, value: number): Buffer {
  return Buffer.concat([varint((field << 3) | 0), varint(value)]);
}

function fieldBytes(field: number, value: Buffer): Buffer {
  return Buffer.concat([varint((field << 3) | 2), varint(value.length), value]);
}

function antigravityMetadata(): Buffer {
  const seconds = Math.floor(WHEN / 1000);
  const nanos = (WHEN % 1000) * 1_000_000;
  return Buffer.concat([
    fieldBytes(1, Buffer.concat([fieldVarint(1, seconds), fieldVarint(2, nanos)])),
    fieldBytes(
      9,
      Buffer.concat([
        fieldVarint(2, 1000),
        fieldVarint(3, 50),
        fieldVarint(5, 200),
        fieldVarint(4, 10),
        fieldVarint(9, 7),
        fieldVarint(10, 43),
      ]),
    ),
    fieldBytes(24, fieldBytes(8, Buffer.from("gemini-3.8-flash"))),
  ]);
}

describe("readSqliteUsageRecords", () => {
  it("reads OpenCode step-finish rows", async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "opencode-usage-"));
    const file = NodePath.join(dir, "opencode.db");
    const database = new NodeSqlite.DatabaseSync(file);
    database.exec(`
      CREATE TABLE part (
        id TEXT,
        message_id TEXT,
        session_id TEXT,
        time_created INTEGER,
        data TEXT
      );
      CREATE TABLE message (
        id TEXT,
        data TEXT
      );
    `);
    const insertPart = database.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
    );
    insertPart.run(
      "part-1",
      "msg-1",
      "ses_1",
      WHEN,
      '{"type":"step-finish","tokens":{"input":80,"output":20,"reasoning":5,"cache":{"read":30,"write":4}},"cost":0.25}',
    );
    insertPart.run("part-2", "msg-2", "ses_1", WHEN, '{"type":"text","text":"hello"}');
    database
      .prepare("INSERT INTO message (id, data) VALUES (?, ?)")
      .run("msg-1", '{"modelID":"deepseek-v4-flash"}');
    database.close();

    const records = readSqliteUsageRecords(file, "opencode");
    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      provider: "opencode",
      model: "deepseek-v4-flash",
      sessionId: "ses_1",
      timestampMs: WHEN,
      reportedCostUsd: 0.25,
      totals: {
        uncachedInputTokens: 80,
        cachedInputTokens: 30,
        cacheCreationTokens: 4,
        outputTokens: 25,
        reasoningTokens: 5,
      },
    });
    await NodeFSP.rm(dir, { recursive: true, force: true });
  });

  it("reads Antigravity generation steps", async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "antigravity-usage-"));
    const file = NodePath.join(dir, "11111111-1111-4111-8111-111111111111.db");
    const database = new NodeSqlite.DatabaseSync(file);
    database.exec("CREATE TABLE steps (idx INTEGER, step_type INTEGER, metadata BLOB)");
    database
      .prepare("INSERT INTO steps (idx, step_type, metadata) VALUES (?, ?, ?)")
      .run(4, 15, antigravityMetadata());
    database.close();

    const records = readSqliteUsageRecords(file, "antigravity");
    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      provider: "antigravity",
      model: "gemini-3.8-flash",
      sessionId: "11111111-1111-4111-8111-111111111111",
      timestampMs: WHEN,
      totals: {
        uncachedInputTokens: 1000,
        cachedInputTokens: 200,
        cacheCreationTokens: 10,
        outputTokens: 50,
        reasoningTokens: 7,
      },
    });
    await NodeFSP.rm(dir, { recursive: true, force: true });
  });
  it("resolves served models through packed generation step indices, not row indices", async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "antigravity-model-"));
    try {
      const file = NodePath.join(dir, "session.db");
      const db = new NodeSqlite.DatabaseSync(file);
      db.exec(
        "CREATE TABLE steps (idx INTEGER, step_type INTEGER, metadata BLOB); CREATE TABLE gen_metadata (idx INTEGER, data BLOB)",
      );
      db.prepare("INSERT INTO steps VALUES (?,15,?)").run(42, antigravityMetadata());
      db.prepare("INSERT INTO steps VALUES (?,15,?)").run(43, antigravityMetadata());
      db.prepare("INSERT INTO gen_metadata VALUES (?,?)").run(
        3,
        Buffer.concat([
          fieldBytes(1, fieldBytes(19, Buffer.from("gemini-3.6-flash-tiered"))),
          fieldBytes(2, Buffer.concat([varint(42), varint(43)])),
        ]),
      );
      db.close();
      const rows = readSqliteUsageRecords(file, "antigravity");
      expect(rows).toHaveLength(1);
      expect(rows?.[0]?.dedupeKey).toBe("antigravity:session:generation:3");
      expect(rows?.[0]?.model).toBe("gemini-3.6-flash");
      expect(rows?.[0]?.totals).toMatchObject({
        outputTokens: 50,
        reasoningTokens: 7,
        cacheCreationTokens: 10,
      });
    } finally {
      await NodeFSP.rm(dir, { recursive: true, force: true });
    }
  });
});
