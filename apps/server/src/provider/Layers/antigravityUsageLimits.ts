/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=20m; seat=codex; date=2026-10-17 */
import type {
  AntigravityAuthMethod,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { makeUnavailableUsageLimits, makeUsageLimits } from "../providerUsageLimits.ts";

const Token = Schema.Struct({
  client_id: Schema.String,
  client_secret: Schema.String,
  refresh_token: Schema.String,
});
const decodeToken = Schema.decodeUnknownEffect(Schema.fromJsonString(Token));
const Quota = Schema.Struct({
  buckets: Schema.Array(
    Schema.Struct({
      modelId: Schema.String,
      remainingFraction: Schema.optional(Schema.Finite),
      resetTime: Schema.optional(Schema.String),
    }),
  ),
});
const decodeQuota = Schema.decodeUnknownSync(Quota);
const AccessToken = Schema.Struct({ access_token: Schema.String });
const decodeAccessToken = Schema.decodeUnknownEffect(AccessToken);

/** Google fractions are remaining quota; they are not percentages consumed. */
export function antigravityQuotaToLimits(
  document: unknown,
  checkedAt: string,
): ServerProviderUsageLimits {
  const quota = decodeQuota(document);
  const windows: ServerProviderUsageWindow[] = [];
  const seen = new Set<string>();
  for (const bucket of quota.buckets) {
    if (!/^(gemini|claude|gpt)-/.test(bucket.modelId) || seen.has(bucket.modelId)) continue;
    const remaining = bucket.remainingFraction;
    if (remaining === undefined || remaining < 0 || remaining > 1) continue;
    seen.add(bucket.modelId);
    const reset = bucket.resetTime;
    windows.push({
      id: bucket.modelId,
      kind: "other",
      label: bucket.modelId,
      usedPercent: (1 - remaining) * 100,
      ...(reset && Number.isFinite(Date.parse(reset)) ? { resetsAt: reset } : {}),
    });
  }
  return windows.length
    ? makeUsageLimits({ checkedAt, windows })
    : makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Google returned no model quota windows.",
      });
}

/** Read this instance's existing OAuth grant; no prompts, sign-in or agent turn. */
export const probeAntigravityUsageLimits = Effect.fn("probeAntigravityUsageLimits")(function* (
  profileDirectory: string,
  authMethod: AntigravityAuthMethod,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (authMethod !== "oauth-personal" && authMethod !== "oauth-business") {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "unsupported",
      message: "Google subscription quota requires an OAuth account; API-key quotas are separate.",
    });
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const client = yield* HttpClient.HttpClient;
  return yield* Effect.gen(function* () {
    const credentials = yield* fs
      .readFileString(path.join(profileDirectory, "antigravity-acp", "acp_token.json"))
      .pipe(Effect.flatMap(decodeToken));
    const auth = yield* client
      .execute(
        HttpClientRequest.post("https://oauth2.googleapis.com/token").pipe(
          HttpClientRequest.bodyUrlParams({ ...credentials, grant_type: "refresh_token" }),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.flatMap(decodeAccessToken),
        Effect.timeout("10 seconds"),
      );
    // The stored project belongs to ACP's API surface. Supplying it here makes
    // valid consumer quota reads fail with 403; this endpoint resolves the account.
    const quota = yield* client
      .execute(
        HttpClientRequest.post(
          "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
        ).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${auth.access_token}`),
          HttpClientRequest.setHeader("User-Agent", "google-cloud-sdk antigravity"),
          HttpClientRequest.bodyJsonUnsafe({}),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.timeout("10 seconds"),
      );
    return yield* Effect.try(() => antigravityQuotaToLimits(quota, checkedAt));
  }).pipe(
    Effect.orElseSucceed(() =>
      makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Could not read Google quota. Check Antigravity sign-in and refresh limits.",
      }),
    ),
  );
});
