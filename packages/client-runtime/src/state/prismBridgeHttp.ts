/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { PrismBridgeStatus } from "@t3tools/shared/prismBridge";
import { EnvironmentHttpCommonError } from "@t3tools/contracts";
import { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";

export const requestPrismBridge = Effect.fn("clientRuntime.requestPrismBridge")(function* (
  prepared: PreparedConnection,
  action: "status" | "sync",
) {
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  const method = action === "sync" ? "POST" : "GET";
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared,
    signer,
    remoteAuthorization,
    method,
    timeoutMs: 10_000,
    url: (base) => new URL(`/api/prism/${action}`, base).toString(),
    request: ({ headers, url }) =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const options = {
          headers: {
            ...(headers.authorization ? { authorization: headers.authorization } : {}),
            ...(headers.dpop ? { dpop: headers.dpop } : {}),
          },
        };
        const response = yield* method === "POST"
          ? client.post(url, options)
          : client.get(url, options);
        if (response.status < 200 || response.status >= 300) {
          const error = yield* HttpClientResponse.schemaBodyJson(EnvironmentHttpCommonError)(
            response,
          );
          return yield* Effect.fail(error);
        }
        return yield* HttpClientResponse.schemaBodyJson(PrismBridgeStatus)(response);
      }),
  });
});
