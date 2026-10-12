/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  emptyUpstreamStatus,
  fetchUpstreamStatus,
  type UpstreamStatus,
} from "@t3tools/shared/upstream";
import packageJson from "../package.json" with { type: "json" };

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
  const checkNow = Effect.promise(checkUpstreamNow);
  // External checks cannot delay startup. Closing the scope stops the loop.
  yield* Effect.forever(checkNow.pipe(Effect.andThen(Effect.sleep("5 minutes")))).pipe(
    Effect.forkScoped,
  );
  return {
    status: Effect.sync(getUpstreamStatus),
    checkNow,
  } satisfies UpstreamMonitorService["Service"];
});
export const layer = Layer.effect(UpstreamMonitorService, make);
