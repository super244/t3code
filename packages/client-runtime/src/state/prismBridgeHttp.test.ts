/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RelayConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import { ManagedRelayDpopSigner, type ManagedRelayDpopProofInput } from "../relay/managedRelay.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import { requestPrismBridge } from "./prismBridgeHttp.ts";
const target = new RelayConnectionTarget({
  environmentId: EnvironmentId.make("fixture"),
  label: "Fixture",
});
const prepared: PreparedConnection = {
  environmentId: target.environmentId,
  label: target.label,
  target,
  httpBaseUrl: "https://old.example.test",
  socketUrl: "wss://old.example.test/ws",
  httpAuthorization: null,
};
const status = {
  synced: false,
  activeThemeId: null,
  activeThemeName: null,
  lastSyncedAt: null,
  settingsPath: null,
  error: "Prism settings were not found.",
};

describe("authenticated Prism requests", () => {
  it.effect("sends cookie requests to the prepared environment and validates its response", () =>
    Effect.gen(function* () {
      const calls: { url: string; init: RequestInit }[] = [];
      const result = yield* requestPrismBridge(prepared, "status").pipe(
        Effect.provide(
          remoteHttpClientLayer(async (url, init) => {
            calls.push({ url: String(url), init: init ?? {} });
            return Response.json(status);
          }),
        ),
      );
      expect(result).toEqual(status);
      expect(calls[0]?.url).toBe("https://old.example.test/api/prism/status");
      expect(calls[0]?.init.credentials).toBe("include");
    }),
  );
  it.effect("uses bearer authorization for a remote host sync", () =>
    Effect.gen(function* () {
      const calls: RequestInit[] = [];
      yield* requestPrismBridge(
        { ...prepared, httpAuthorization: { _tag: "Bearer", token: "fixture-token" } },
        "sync",
      ).pipe(
        Effect.provide(
          remoteHttpClientLayer(async (_url, init) => {
            calls.push(init ?? {});
            return Response.json(status);
          }),
        ),
      );
      expect(calls[0]?.method).toBe("POST");
      expect(new Headers(calls[0]?.headers).get("authorization")).toBe("Bearer fixture-token");
    }),
  );
  it.effect("renews a rejected relay credential with a proof bound to the new request URL", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const proofs: ManagedRelayDpopProofInput[] = [];
      const auth = RemoteEnvironmentAuthorization.of({
        authorizeBearer: () => Effect.die("unused"),
        authorizeDpop: () => Effect.die("unused"),
        authorizeDpopHttp: ({ rejectedAccessToken }) =>
          Effect.succeed({
            environmentId: target.environmentId,
            label: target.label,
            httpBaseUrl: rejectedAccessToken
              ? "https://renewed.example.test"
              : "https://current.example.test",
            httpAuthorization: {
              _tag: "Dpop",
              accessToken: rejectedAccessToken ? "new" : "current",
              expiresAtEpochMs: 3600000,
            },
          }),
      });
      const signer = ManagedRelayDpopSigner.of({
        thumbprint: Effect.succeed("fixture"),
        createProof: (input) =>
          Effect.sync(() => {
            proofs.push(input);
            return "fixture-proof";
          }),
      });
      yield* requestPrismBridge(
        {
          ...prepared,
          httpAuthorization: { _tag: "Dpop", accessToken: "old", expiresAtEpochMs: 0 },
        },
        "sync",
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(RemoteEnvironmentAuthorization, auth),
            Layer.succeed(ManagedRelayDpopSigner, signer),
            remoteHttpClientLayer(async (url) => {
              calls.push(String(url));
              return calls.length === 1
                ? Response.json(
                    {
                      _tag: "EnvironmentAuthInvalidError",
                      code: "auth_invalid",
                      reason: "invalid_credential",
                      traceId: "fixture",
                    },
                    { status: 401 },
                  )
                : Response.json(status);
            }),
          ),
        ),
      );
      expect(calls).toEqual([
        "https://current.example.test/api/prism/sync",
        "https://renewed.example.test/api/prism/sync",
      ]);
      expect(proofs.map((proof) => proof.url)).toEqual(calls);
      expect(proofs.map((proof) => proof.method)).toEqual(["POST", "POST"]);
    }),
  );
  it.effect("rejects invalid status data", () =>
    Effect.gen(function* () {
      const error = yield* requestPrismBridge(prepared, "status").pipe(
        Effect.provide(remoteHttpClientLayer(async () => Response.json({ synced: true }))),
        Effect.flip,
      );
      expect(error._tag).toBe("RemoteEnvironmentAuthInvalidJsonError");
    }),
  );
});
