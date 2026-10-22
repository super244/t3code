/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=60m; seat=codex; date=2026-10-15 */
/* agent-watermark: model=opus-5.5; effort=high; duration=35m; seat=claude-code; date=2026-10-13 */
// @effect-diagnostics nodeBuiltinImport:off -- a loopback stub server for the relay client.
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  ClaudeRelayUnavailable,
  detectClaudeRelay,
  relayStructuredTurn,
  reportClaudeSpend,
} from "./claudeRelay.ts";

let server: NodeHttp.Server;
let baseUrl = "";
let seen: Array<{ path: string; auth: string | undefined; body: Record<string, unknown> }> = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };
let received: () => void = () => undefined;

beforeEach(async () => {
  seen = [];
  server = NodeHttp.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      seen.push({ path: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(raw) });
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
      received();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`;
});

afterEach(() => {
  server.close();
});

describe("claudeRelay", () => {
  it("retries failed acknowledgements without changing the cumulative accounting key", async () => {
    reply = { status: 503, body: { ok: false } };
    const outcome = await reportClaudeSpend(
      { token: "t0k", baseUrl },
      {
        sessionId: "s",
        totalCostUsd: 7,
        apiKeySource: "none",
        resumed: false,
        accountingId: "runtime",
        baselineCostUsd: 0,
      },
    );
    expect(outcome).toBe("failed");
    expect(seen).toHaveLength(2);
    expect(seen[0]?.body).toEqual(seen[1]?.body);
  });

  it("refuses to substitute a reservation for an unknown resumed-session baseline", async () => {
    const outcome = await reportClaudeSpend(
      { token: "t0k", baseUrl },
      {
        sessionId: "s",
        totalCostUsd: 70,
        apiKeySource: "none",
        resumed: true,
        accountingId: "runtime",
      },
    );
    expect(outcome).toBe("failed");
    expect(seen).toHaveLength(0);
  });

  it("is off under the test runner unless asked, and reads the token file", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-relay-"));
    const token = NodePath.join(dir, "token");
    NodeFS.writeFileSync(token, "t0k\n");
    expect(
      detectClaudeRelay({ VITEST: "true", T3CODE_CLAUDE_RELAY_TOKEN_FILE: token }),
    ).toBeUndefined();
    expect(
      detectClaudeRelay({ T3CODE_CLAUDE_RELAY: "0", T3CODE_CLAUDE_RELAY_TOKEN_FILE: token }),
    ).toBeUndefined();
    expect(
      detectClaudeRelay({
        VITEST: "true",
        T3CODE_CLAUDE_RELAY: "1",
        T3CODE_CLAUDE_RELAY_TOKEN_FILE: token,
      }),
    ).toEqual({ token: "t0k", baseUrl: "http://127.0.0.1:3975" });
  });

  it("asks for a tool-free, memory-free structured turn and returns the structured output", async () => {
    reply = { status: 200, body: { ok: true, structured: { subject: "fix: thing" }, text: "" } };
    const value = await relayStructuredTurn(
      { token: "t0k", baseUrl },
      {
        prompt: "write it",
        schema: { type: "object" },
        model: "claude-haiku-5-5",
        timeoutMs: 5_000,
      },
    );
    expect(value).toEqual({ subject: "fix: thing" });
    expect(seen[0]).toMatchObject({
      path: "/v1/turn",
      auth: "Bearer t0k",
      body: {
        app: "t3code",
        thread: null,
        memory: false,
        prompt: "write it",
        model: "claude-haiku-5-5",
      },
    });
  });

  it("a refusal is an error with the relay's reason; a closed port means unavailable", async () => {
    reply = { status: 402, body: { ok: false, error: "cap reached" } };
    await expect(
      relayStructuredTurn(
        { token: "t", baseUrl },
        { prompt: "x", schema: {}, model: "m", timeoutMs: 5_000 },
      ),
    ).rejects.toThrow("Claude Relay: cap reached");
    const closed = NodeHttp.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = (closed.address() as NodeNet.AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    await expect(
      relayStructuredTurn(
        { token: "t", baseUrl: `http://127.0.0.1:${closedPort}` },
        { prompt: "x", schema: {}, model: "m", timeoutMs: 5_000 },
      ),
    ).rejects.toBeInstanceOf(ClaudeRelayUnavailable);
  });

  it("reports the full increase from a resumed SDK baseline without the unseen-resume cap", async () => {
    reply = { status: 200, body: { ok: true } };
    const arrived = new Promise<void>((resolve) => {
      received = resolve;
    });
    reportClaudeSpend(
      { token: "t0k", baseUrl },
      {
        sessionId: "existing-conversation",
        totalCostUsd: 42,
        baselineCostUsd: 35,
        accountingId: "new-runtime",
        apiKeySource: "/login managed key",
        resumed: true,
      },
    );
    await arrived;
    expect(seen[0]).toMatchObject({
      body: {
        sessionId: "t3:new-runtime:existing-conversation",
        totalCostUsd: 7,
        resumed: false,
      },
    });
  });

  it("reports a session's cumulative cost to the ledger, and skips when there is nothing to report", async () => {
    reply = { status: 200, body: { ok: true } };
    const arrived = new Promise<void>((resolve) => {
      received = resolve;
    });
    reportClaudeSpend(undefined, {
      sessionId: "s",
      totalCostUsd: 1,
      apiKeySource: undefined,
      resumed: false,
    });
    reportClaudeSpend(
      { token: "t0k", baseUrl },
      { sessionId: undefined, totalCostUsd: 1, apiKeySource: undefined, resumed: false },
    );
    reportClaudeSpend(
      { token: "t0k", baseUrl },
      { sessionId: "s1", totalCostUsd: 0.25, apiKeySource: "/login managed key", resumed: true },
    );
    await arrived;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      path: "/v1/ledger",
      body: {
        app: "t3code",
        sessionId: "s1",
        totalCostUsd: 0.25,
        apiKeySource: "/login managed key",
        resumed: true,
      },
    });
  });
});
