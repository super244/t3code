/* agent-watermark: model=haiku-5.5; effort=high; duration=65m; seat=claude-code; date=2026-10-13 */
import {
  EnvironmentId,
  OrchestrationSearchThreadsInput,
  type OrchestrationSearchThreadsResult,
  type OrchestrationThreadSearchMatch,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

export interface EnvironmentThreadSearchMatch extends OrchestrationThreadSearchMatch {
  readonly environmentId: EnvironmentId;
}

export interface ThreadSearchResultsState {
  readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
  readonly isLoading: boolean;
}

/**
 * How many matches a search returns per thread, and whether archived threads
 * are searched. The palette keeps the defaults (one snippet per active thread);
 * the thread search surface asks for more.
 */
export interface ThreadSearchOptions {
  readonly matchesPerThread: number;
  readonly includeArchived: boolean;
}

export const DEFAULT_THREAD_SEARCH_OPTIONS: ThreadSearchOptions = Object.freeze({
  matchesPerThread: 1,
  includeArchived: false,
});

const ThreadSearchOptionsSchema = Schema.Struct({
  matchesPerThread: Schema.Int,
  includeArchived: Schema.Boolean,
});

const ThreadSearchKey = Schema.fromJsonString(
  Schema.Tuple([
    Schema.Array(EnvironmentId),
    OrchestrationSearchThreadsInput.fields.query,
    ThreadSearchOptionsSchema,
  ]),
);
const decodeThreadSearchKey = Schema.decodeUnknownOption(ThreadSearchKey);

export function makeThreadSearchKey(
  environmentIds: ReadonlyArray<EnvironmentId>,
  query: string,
  options: ThreadSearchOptions = DEFAULT_THREAD_SEARCH_OPTIONS,
): string {
  return JSON.stringify([
    [...environmentIds].sort((left, right) => left.localeCompare(right)),
    query,
    {
      matchesPerThread: options.matchesPerThread,
      includeArchived: options.includeArchived,
    },
  ]);
}

function parseThreadSearchKey(key: string) {
  return decodeThreadSearchKey(key);
}

export function threadSearchMatchKey(
  match: Pick<EnvironmentThreadSearchMatch, "environmentId" | "threadId">,
): string {
  return JSON.stringify([match.environmentId, match.threadId]);
}

/**
 * Combines one search query atom per environment. Invalid search keys, failed
 * requests, and disconnected environments contribute no content matches,
 * preserving local title search as the compatibility fallback.
 */
export function createThreadSearchResultsAtomFamily<E>(options: {
  readonly getSearchAtom: (
    environmentId: EnvironmentId,
    query: string,
    options: ThreadSearchOptions,
  ) => Atom.Atom<AsyncResult.AsyncResult<OrchestrationSearchThreadsResult, E>>;
  readonly labelPrefix: string;
}) {
  return Atom.family((key: string) =>
    Atom.make((get): ThreadSearchResultsState => {
      const parsedKey = parseThreadSearchKey(key);
      if (Option.isNone(parsedKey)) {
        return { matches: [], isLoading: false };
      }

      const [environmentIds, query, searchOptions] = parsedKey.value;
      const matches: EnvironmentThreadSearchMatch[] = [];
      let isLoading = false;

      for (const environmentId of environmentIds) {
        const result = get(options.getSearchAtom(environmentId, query, searchOptions));
        isLoading ||= result.waiting;
        const value = Option.getOrNull(AsyncResult.value(result));
        if (value !== null) {
          matches.push(
            ...value.matches.map((match) => ({
              ...match,
              environmentId,
            })),
          );
        }
      }

      return { matches, isLoading };
    }).pipe(Atom.withLabel(`${options.labelPrefix}:${key}`)),
  );
}
