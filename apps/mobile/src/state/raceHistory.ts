/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=24m; seat=codex; date=2026-10-19 */
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";

export const raceHistoryEnvironment = {
  list: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "mobile-environment-data:race:list-history",
    tag: WS_METHODS.raceListHistory,
    staleTimeMs: 10_000,
  }),
};
