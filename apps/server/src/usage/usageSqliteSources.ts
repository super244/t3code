/* agent-watermark: model=muse-spark; effort=high; duration=50m; seat=opencode; date=2026-10-07 */
/* agent-watermark: model=grok-4.7; effort=default; duration=40m; seat=cursor; date=2026-09-30 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=2m; seat=antigravity; date=2026-10-02 */
// @effect-diagnostics nodeBuiltinImport:off
/**
 * Usage records from provider stores that are SQLite rather than JSONL.
 *
 * OpenCode keeps per-step token totals in `opencode.db`. Antigravity keeps
 * them in each conversation's `steps.metadata` protobuf. Both are read
 * read-only so a running CLI can keep the database open.
 *
 * @module usageSqliteSources
 */
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import type { UsageProviderKind, UsageTokenTotals } from "@t3tools/contracts";

import type { UsageRecord } from "./usageTranscripts.ts";

const EMPTY_TOTALS: UsageTokenTotals = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

/** Skip pathological metadata blobs. Real step metadata is a few hundred bytes. */
const MAX_METADATA_BYTES = 1_000_000;

type SqliteProvider = Extract<UsageProviderKind, "opencode" | "antigravity">;

/**
 * Parses one provider database into usage records.
 *
 * Returns `null` when the file cannot be read, so the caller does not cache
 * the miss. Returns an empty list when the file is a database of the wrong
 * shape: that result is stable and safe to cache.
 */
export function readSqliteUsageRecords(
  filePath: string,
  provider: SqliteProvider,
): readonly UsageRecord[] | null {
  let database: NodeSqlite.DatabaseSync;
  try {
    database = new NodeSqlite.DatabaseSync(filePath, { readOnly: true, timeout: 2_000 });
  } catch {
    return null;
  }

  try {
    if (provider === "opencode") return readOpenCode(database);
    return readAntigravity(database, filePath);
  } catch {
    return null;
  } finally {
    database.close();
  }
}

function hasTable(database: NodeSqlite.DatabaseSync, name: string): boolean {
  const row = database
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { readonly present?: number } | undefined;
  return row?.present === 1;
}

function asBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function positiveInt(value: unknown): number {
  const numeric = typeof value === "bigint" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) && numeric > 0
    ? Math.trunc(numeric)
    : 0;
}

function timestampMs(value: unknown): number | null {
  const numeric = typeof value === "bigint" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric <= 0) return null;
  // OpenCode stores milliseconds. A seconds-scale value is still accepted.
  return numeric < 1_000_000_000_000 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
}

function readOpenCode(database: NodeSqlite.DatabaseSync): readonly UsageRecord[] {
  if (!hasTable(database, "part")) return [];

  const rows = database
    .prepare(
      `SELECT
         p.id AS id,
         p.session_id AS session_id,
         p.time_created AS time_created,
         json_extract(p.data, '$.tokens.input') AS input_tokens,
         json_extract(p.data, '$.tokens.output') AS output_tokens,
         json_extract(p.data, '$.tokens.reasoning') AS reasoning_tokens,
         json_extract(p.data, '$.tokens.cache.read') AS cache_read,
         json_extract(p.data, '$.tokens.cache.write') AS cache_write,
         json_extract(p.data, '$.cost') AS cost,
         json_extract(m.data, '$.modelID') AS model_id
       FROM part AS p
       LEFT JOIN message AS m ON m.id = p.message_id
       WHERE json_extract(p.data, '$.type') = 'step-finish'`,
    )
    .all() as readonly Record<string, unknown>[];

  const records: UsageRecord[] = [];
  for (const row of rows) {
    const createdAt = timestampMs(row["time_created"]);
    if (createdAt === null) continue;

    // OpenCode's step total is input + cache + output + reasoning. Reasoning is
    // not already inside output, so it is folded into outputTokens and also
    // recorded as the reasoning subset the rest of usage already expects.
    const reasoningTokens = positiveInt(row["reasoning_tokens"]);
    const totals: UsageTokenTotals = {
      uncachedInputTokens: positiveInt(row["input_tokens"]),
      cachedInputTokens: positiveInt(row["cache_read"]),
      cacheCreationTokens: positiveInt(row["cache_write"]),
      outputTokens: positiveInt(row["output_tokens"]) + reasoningTokens,
      reasoningTokens,
    };
    const cost = row["cost"];
    const reportedCostUsd =
      typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null;
    if (sameTotals(totals, EMPTY_TOTALS) && reportedCostUsd === null) continue;

    const model = typeof row["model_id"] === "string" ? row["model_id"].trim() : "";
    const sessionId = typeof row["session_id"] === "string" ? row["session_id"] : "";
    const partId = typeof row["id"] === "string" ? row["id"] : "";

    records.push({
      provider: "opencode",
      timestampMs: createdAt,
      model: model.length > 0 ? model : "opencode",
      sessionId,
      totals,
      reportedCostUsd,
      dedupeKey: partId.length > 0 ? `opencode:${partId}` : null,
    });
  }
  return records;
}

function readAntigravity(
  database: NodeSqlite.DatabaseSync,
  filePath: string,
): readonly UsageRecord[] {
  if (!hasTable(database, "steps")) return [];

  const rows = database
    .prepare("SELECT idx, metadata FROM steps WHERE step_type = 15")
    .all() as readonly Record<string, unknown>[];
  const sessionId = NodePath.basename(filePath, ".db");
  const records: UsageRecord[] = [];

  for (const row of rows) {
    const metadata = asBuffer(row["metadata"]);
    if (metadata === null || metadata.length === 0 || metadata.length > MAX_METADATA_BYTES) {
      continue;
    }
    const record = parseAntigravityMetadata(metadata, sessionId, positiveInt(row["idx"]));
    if (record !== null) records.push(record);
  }
  return records;
}

/**
 * Antigravity step metadata is a protobuf message.
 *
 * Field 9 is the usage submessage. On real conversations its fields line up as
 * uncached input (2), candidates (3), cache read (5), cache write (9), and
 * thoughts (10). Thoughts are not inside the candidate count, so they are
 * added to output and also kept as `reasoningTokens` (a subset, not summed
 * again into the token total).
 */
function parseAntigravityMetadata(
  metadata: Buffer,
  sessionId: string,
  stepIndex: number,
): UsageRecord | null {
  const fields = readFields(metadata);
  if (fields === null) return null;

  const timestamp = timestampFrom(fields);
  if (timestamp === null) return null;

  const usageMessage = bytesField(fields, 9);
  if (usageMessage === null) return null;
  const usage = readFields(usageMessage);
  if (usage === null) return null;

  const thoughts = positiveInt(varintField(usage, 10));
  const totals: UsageTokenTotals = {
    uncachedInputTokens: positiveInt(varintField(usage, 2)),
    cachedInputTokens: positiveInt(varintField(usage, 5)),
    cacheCreationTokens: positiveInt(varintField(usage, 9)),
    outputTokens: positiveInt(varintField(usage, 3)) + thoughts,
    reasoningTokens: thoughts,
  };
  if (sameTotals(totals, EMPTY_TOTALS)) return null;

  return {
    provider: "antigravity",
    timestampMs: timestamp,
    model: modelName(fields),
    sessionId,
    totals,
    reportedCostUsd: null,
    dedupeKey: sessionId.length > 0 ? `antigravity:${sessionId}:${stepIndex}` : null,
  };
}

function sameTotals(left: UsageTokenTotals, right: UsageTokenTotals): boolean {
  return (
    left.uncachedInputTokens === right.uncachedInputTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    left.cacheCreationTokens === right.cacheCreationTokens &&
    left.outputTokens === right.outputTokens &&
    left.reasoningTokens === right.reasoningTokens
  );
}

function timestampFrom(fields: readonly ProtoField[]): number | null {
  const stamp = bytesField(fields, 1);
  if (stamp === null) return null;
  const nested = readFields(stamp);
  if (nested === null) return null;
  const seconds = varintField(nested, 1);
  if (seconds < 1_000_000_000) return null;
  const nanos = varintField(nested, 2);
  return seconds * 1000 + Math.trunc(nanos / 1_000_000);
}

function modelName(fields: readonly ProtoField[]): string {
  const modelMessage = bytesField(fields, 24);
  if (modelMessage === null) return "antigravity";
  const nested = readFields(modelMessage);
  if (nested === null) return "antigravity";
  const raw = bytesField(nested, 8);
  if (raw === null) return "antigravity";
  const text = raw.toString("utf8").trim();
  if (text.length === 0 || text.length > 120) return "antigravity";
  return text;
}

type ProtoField =
  | { readonly field: number; readonly kind: "varint"; readonly value: number }
  | { readonly field: number; readonly kind: "bytes"; readonly value: Buffer };

function bytesField(fields: readonly ProtoField[], field: number): Buffer | null {
  for (const entry of fields) {
    if (entry.field === field && entry.kind === "bytes") return entry.value;
  }
  return null;
}

function varintField(fields: readonly ProtoField[], field: number): number {
  for (const entry of fields) {
    if (entry.field === field && entry.kind === "varint") return entry.value;
  }
  return 0;
}

function readVarint(
  buffer: Buffer,
  offset: number,
): { readonly value: number; readonly next: number } | null {
  let value = 0;
  let shift = 0;
  let index = offset;
  while (index < buffer.length && shift <= 49) {
    const byte = buffer[index]!;
    index += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: index };
    shift += 7;
  }
  return null;
}

function readFields(buffer: Buffer): readonly ProtoField[] | null {
  const fields: ProtoField[] = [];
  let index = 0;
  while (index < buffer.length) {
    const key = readVarint(buffer, index);
    if (key === null) return null;
    index = key.next;
    const field = Math.floor(key.value / 8);
    const wire = key.value % 8;
    if (field <= 0 || field > 10_000) return null;
    if (wire === 0) {
      const value = readVarint(buffer, index);
      if (value === null) return null;
      index = value.next;
      fields.push({ field, kind: "varint", value: value.value });
      continue;
    }
    if (wire === 2) {
      const length = readVarint(buffer, index);
      if (length === null) return null;
      index = length.next;
      const end = index + length.value;
      if (end > buffer.length) return null;
      fields.push({ field, kind: "bytes", value: buffer.subarray(index, end) });
      index = end;
      continue;
    }
    if (wire === 1) {
      if (index + 8 > buffer.length) return null;
      index += 8;
      continue;
    }
    if (wire === 5) {
      if (index + 4 > buffer.length) return null;
      index += 4;
      continue;
    }
    return null;
  }
  return fields;
}
