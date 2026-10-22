/* agent-watermark: model=opus-5.5; effort=high; duration=3m; seat=claude-code; date=2026-10-22 */
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

/** Bumped after every write so open memory lists re-read the server. */
const memoryRevision = Atom.family((_environmentId: string) =>
  Atom.make(0).pipe(Atom.keepAlive, Atom.withLabel("memory:revision")),
);

const bumpRevision = (
  target: { readonly environmentId: EnvironmentId },
  registry: {
    get: <A>(atom: Atom.Atom<A>) => A;
    set: <A>(atom: Atom.Writable<A>, value: A) => void;
  },
) =>
  Effect.sync(() => {
    const atom = memoryRevision(target.environmentId);
    registry.set(atom, registry.get(atom) + 1);
  });

export const memoryEnvironment = {
  list: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:memory:list",
    tag: WS_METHODS.memoryList,
    // Agents save from their sessions too, so a list on screen re-reads now and then.
    staleTimeMs: 15_000,
    refreshTrigger: ({ environmentId }) => memoryRevision(environmentId),
  }),
  save: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:memory:save",
    tag: WS_METHODS.memorySave,
    onSettled: bumpRevision,
  }),
  remove: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:memory:delete",
    tag: WS_METHODS.memoryDelete,
    onSettled: bumpRevision,
  }),
};
