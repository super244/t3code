/* agent-watermark: model=opus-5.5; effort=high; duration=35m; seat=claude-code; date=2026-10-09 */
import {
  buildThreadReport,
  threadReportFilename,
  type ThreadReportFormat,
} from "@t3tools/client-runtime/threadReport";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { toastManager } from "./components/ui/toast";
import { downloadPlanAsTextFile } from "./proposedPlan";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readProject } from "./state/entities";
import { environmentThreadDetails } from "./state/threads";
import type { EnvironmentThread } from "@t3tools/client-runtime/state/models";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";

/**
 * Thread detail for a report. An open thread already holds it; a sidebar row
 * usually does not, so subscribing mounts the detail atom (which loads it) and
 * the first non-null value is used. The subscription is dropped either way.
 */
export function readThreadDetailOnce(
  ref: ScopedThreadRef,
  timeoutMs = 10_000,
): Promise<EnvironmentThread> {
  const atom = environmentThreadDetails.detailAtom(ref);
  const current = appAtomRegistry.get(atom);
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    const timeout = setTimeout(() => {
      unsubscribe?.();
      reject(new Error("The thread's history did not load in time."));
    }, timeoutMs);
    const finish = (detail: EnvironmentThread | null) => {
      if (!detail) return;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(detail);
    };
    unsubscribe = appAtomRegistry.subscribe(atom, finish);
    finish(appAtomRegistry.get(atom));
  });
}

async function reportFor(ref: ScopedThreadRef, format: ThreadReportFormat) {
  const thread = await readThreadDetailOnce(ref);
  const project = readProject(scopeProjectRef(ref.environmentId, thread.projectId));
  return {
    thread,
    text: buildThreadReport({
      thread,
      projectTitle: project?.title ?? null,
      format,
      now: new Date(),
    }),
  };
}

function failed(title: string, error: unknown) {
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "An error occurred.",
  });
}

/** Download the thread as a Markdown report. */
export async function exportThreadReport(ref: ScopedThreadRef): Promise<void> {
  try {
    const { thread, text } = await reportFor(ref, "report");
    downloadPlanAsTextFile(threadReportFilename(thread.title), text);
    toastManager.add({
      type: "success",
      title: "Thread exported",
      description: threadReportFilename(thread.title),
    });
  } catch (error) {
    failed("Could not export the thread", error);
  }
}

/** Copy the thread as a full Markdown report, or as a pull-request description. */
export async function copyThreadReport(
  ref: ScopedThreadRef,
  format: ThreadReportFormat,
): Promise<void> {
  try {
    const { text } = await reportFor(ref, format);
    await navigator.clipboard.writeText(text);
    toastManager.add({
      type: "success",
      title: format === "pr" ? "PR description copied" : "Thread copied as Markdown",
      description: `${text.split("\n").length} lines`,
    });
  } catch (error) {
    failed(
      format === "pr" ? "Could not copy the PR description" : "Could not copy the thread",
      error,
    );
  }
}
