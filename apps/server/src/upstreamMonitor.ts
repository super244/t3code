/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
/* agent-watermark: model=haiku-5.5; effort=high; duration=3m; seat=claude-code; date=2026-10-12 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import {
  emptyUpstreamStatus,
  fetchUpstreamStatus,
  type UpstreamStatus,
} from "@t3tools/shared/upstream";
import packageJson from "../package.json" with { type: "json" };
import * as ServerConfig from "./config.ts";
import { readNightlyStatus } from "./upstreamNightly.ts";
import { readUpstreamSharedState } from "./upstreamSharedState.ts";

export type {
  UpstreamStatus,
  UpstreamRelease,
  UpstreamReleaseAsset,
  UpstreamCommit,
} from "@t3tools/shared/upstream";
let cachedUpstreamStatus = emptyUpstreamStatus(packageJson.version);
let pendingCheck: Promise<UpstreamStatus> | null = null;
export function getUpstreamStatus(): UpstreamStatus {
  return cachedUpstreamStatus;
}
export function checkUpstreamNow(): Promise<UpstreamStatus> {
  if (pendingCheck) return pendingCheck;
  cachedUpstreamStatus = { ...cachedUpstreamStatus, isChecking: true, error: null };
  pendingCheck = fetchUpstreamStatus(cachedUpstreamStatus)
    .then((status) => {
      cachedUpstreamStatus = status;
      return status;
    })
    .finally(() => {
      pendingCheck = null;
    });
  return pendingCheck;
}
export class UpstreamMonitorService extends Context.Service<
  UpstreamMonitorService,
  {
    readonly status: Effect.Effect<UpstreamStatus>;
    readonly checkNow: Effect.Effect<UpstreamStatus>;
  }
>()("t3/upstreamMonitor/UpstreamMonitorService") {}
const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  // Captured once so the service methods stay requirement-free: the state read needs
  // the database and filesystem, which the layer already has at construction time.
  const localServices = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | SqlClient.SqlClient
  >();
  const platform = yield* HostProcessPlatform;
  // Both responses carry the shared-state and Nightly facts, read at request time.
  const withLocalFacts = (status: UpstreamStatus) =>
    Effect.gen(function* () {
      const sharedState = yield* readUpstreamSharedState({ stateDir: config.stateDir });
      const nightly = yield* Effect.promise(() =>
        readNightlyStatus({ releases: status.releases, platform }),
      );
      return { ...status, sharedState, nightly };
    }).pipe(Effect.provide(localServices));
  const checkUpstream = Effect.promise(checkUpstreamNow);
  // External checks cannot delay startup. Closing the scope stops the loop.
  yield* Effect.forever(checkUpstream.pipe(Effect.andThen(Effect.sleep("5 minutes")))).pipe(
    Effect.forkScoped,
  );
  return {
    status: Effect.sync(getUpstreamStatus).pipe(Effect.flatMap(withLocalFacts)),
    checkNow: checkUpstream.pipe(Effect.flatMap(withLocalFacts)),
  } satisfies UpstreamMonitorService["Service"];
});

export const layer = Layer.effect(UpstreamMonitorService, make);
