/* agent-watermark: model=opus-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-09 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThread } from "@t3tools/client-runtime/state/models";
import { buildThreadReport } from "@t3tools/client-runtime/threadReport";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Alert, Share } from "react-native";

import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreadDetails } from "../../state/threads";

/** The thread's detail, loading it if the row only held its shell. */
function readDetail(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  timeoutMs = 10_000,
): Promise<EnvironmentThread> {
  const atom = environmentThreadDetails.detailAtom(scopeThreadRef(environmentId, threadId));
  const current = appAtomRegistry.get(atom);
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    const timeout = setTimeout(() => {
      unsubscribe?.();
      reject(new Error("The thread's history did not load in time."));
    }, timeoutMs);
    unsubscribe = appAtomRegistry.subscribe(atom, (detail) => {
      if (!detail) return;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(detail);
    });
  });
}

/** Shares the thread as the same Markdown report web exports, through the system share sheet. */
export async function shareThreadReport(thread: {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly title: string;
}) {
  try {
    const detail = await readDetail(thread.environmentId, thread.id);
    await Share.share({ title: thread.title, message: buildThreadReport({ thread: detail }) });
  } catch (error) {
    Alert.alert(
      "Could not share the thread",
      error instanceof Error ? error.message : "An error occurred.",
    );
  }
}
