/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import { describe, expect, it, vi } from "vite-plus/test";
import { AuthSessionId, type AuthEnvironmentScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { prismRouteLayer, upstreamRouteLayer } from "./http.ts";
import { PrismBridgeService } from "./prismBridge.ts";
import { UpstreamMonitorService } from "./upstreamMonitor.ts";
import { emptyUpstreamStatus } from "@t3tools/shared/upstream";

function routes(scopes: readonly AuthEnvironmentScope[] | null) {
  const sync = vi.fn(() => ({
    synced: true,
    activeThemeId: "prism-tide",
    activeThemeName: "Tide",
    lastSyncedAt: "2026-10-03T12:00:00Z",
    settingsPath: "/fixture/prism.json",
    error: null,
  }));
  let status = emptyUpstreamStatus("0.0.40");
  const auth = {
    authenticateHttpRequest: () =>
      scopes === null
        ? Effect.fail(new EnvironmentAuth.ServerAuthMissingCredentialError({}))
        : Effect.succeed({
            sessionId: AuthSessionId.make("test-session"),
            subject: "test",
            method: "browser-session-cookie",
            scopes,
          }),
  } as unknown as EnvironmentAuth.EnvironmentAuth["Service"];
  const services = Layer.mergeAll(
    Layer.succeed(EnvironmentAuth.EnvironmentAuth, auth),
    Layer.succeed(PrismBridgeService, { status: Effect.sync(sync), syncNow: Effect.sync(sync) }),
    Layer.succeed(UpstreamMonitorService, {
      status: Effect.sync(() => status),
      checkNow: Effect.sync(() => status),
    }),
  );
  const app = HttpRouter.toWebHandler(
    Layer.mergeAll(prismRouteLayer, upstreamRouteLayer).pipe(Layer.provideMerge(services)),
    { disableLogger: true },
  );
  return {
    ...app,
    sync,
    setVersion: (version: string) => {
      status = emptyUpstreamStatus(version);
    },
  };
}
const endpoints = [
  ["/api/prism/status", "GET"],
  ["/api/prism/sync", "POST"],
  ["/api/upstream/status", "GET"],
  ["/api/upstream/check", "POST"],
] as const;
describe("custom integration routes", () => {
  it("does not perform a sync while building the routes", async () => {
    const app = routes(["orchestration:read", "orchestration:operate"]);
    try {
      expect(app.sync).not.toHaveBeenCalled();
      await app.handler(new Request("http://localhost/api/upstream/status"));
      expect(app.sync).not.toHaveBeenCalled();
    } finally {
      await app.dispose();
    }
  });
  it("rejects unauthenticated requests before touching integration services", async () => {
    const app = routes(null);
    try {
      for (const [path, method] of endpoints) {
        expect((await app.handler(new Request(`http://localhost${path}`, { method }))).status).toBe(
          401,
        );
      }
      expect(app.sync).not.toHaveBeenCalled();
    } finally {
      await app.dispose();
    }
  });
  it("requires operate scope for mutations while allowing read-only status", async () => {
    const app = routes(["orchestration:read"]);
    try {
      for (const [path, method] of endpoints) {
        expect((await app.handler(new Request(`http://localhost${path}`, { method }))).status).toBe(
          method === "POST" ? 403 : 200,
        );
      }
      expect(app.sync).toHaveBeenCalledTimes(1);
    } finally {
      await app.dispose();
    }
  });
  it("reads fresh state on every request and runs authorized sync once", async () => {
    const app = routes(["orchestration:read", "orchestration:operate"]);
    try {
      const request = async () => {
        const response = await app.handler(new Request("http://localhost/api/upstream/status"));
        return (await response.json()) as { currentVersion: string };
      };
      expect((await request()).currentVersion).toBe("0.0.40");
      app.setVersion("0.0.41");
      expect((await request()).currentVersion).toBe("0.0.41");
      const result = await app.handler(
        new Request("http://localhost/api/prism/sync", { method: "POST" }),
      );
      expect(result.status).toBe(200);
      expect(app.sync).toHaveBeenCalledTimes(1);
    } finally {
      await app.dispose();
    }
  });
});
