/* agent-watermark: model=opus-5.5; effort=high; duration=6m; seat=claude-code; date=2026-10-19 */
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

/** Bumped after every write so open history lists re-read the server. */
const historyRevision = Atom.family((_environmentId: string) =>
  Atom.make(0).pipe(Atom.keepAlive, Atom.withLabel("race-history:revision")),
);

const bumpRevision = (
  target: { readonly environmentId: EnvironmentId },
  registry: {
    get: <A>(atom: Atom.Atom<A>) => A;
    set: <A>(atom: Atom.Writable<A>, value: A) => void;
  },
) =>
  Effect.sync(() => {
    const atom = historyRevision(target.environmentId);
    registry.set(atom, registry.get(atom) + 1);
  });

export const raceHistoryEnvironment = {
  list: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:race:list-history",
    tag: WS_METHODS.raceListHistory,
    staleTimeMs: 10_000,
    refreshTrigger: ({ environmentId }) => historyRevision(environmentId),
  }),
  record: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:race:record-result",
    tag: WS_METHODS.raceRecordResult,
    onSettled: bumpRevision,
  }),
  forget: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:race:forget-result",
    tag: WS_METHODS.raceForgetResult,
    onSettled: bumpRevision,
  }),
};
