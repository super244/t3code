/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import { useEffect, useSyncExternalStore } from "react";
import {
  emptyUpstreamStatus,
  fetchUpstreamStatus,
  type UpstreamStatus,
} from "@t3tools/shared/upstream";
import { APP_VERSION } from "../../branding";

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
let status = emptyUpstreamStatus(APP_VERSION);
let pending: Promise<void> | null = null;
let lastAttemptAt = 0;
let interval: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function publish(next: UpstreamStatus) {
  status = next;
  listeners.forEach((listener) => listener());
}
export function checkUpstreamTrackerNow(): Promise<void> {
  if (pending) return pending;
  lastAttemptAt = Date.now();
  publish({ ...status, isChecking: true, error: null });
  pending = fetchUpstreamStatus(status)
    .then((next) => {
      publish(next);
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!interval) {
    interval = setInterval(() => {
      void checkUpstreamTrackerNow();
    }, CHECK_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval) {
      clearInterval(interval);
      interval = null;
    }
  };
}
export function useUpstreamTracker() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => status,
    () => status,
  );
  useEffect(() => {
    // Retry on remount only after the normal interval; failures never spin a retry loop.
    if (!lastAttemptAt || Date.now() - lastAttemptAt >= CHECK_INTERVAL_MS) {
      void checkUpstreamTrackerNow();
    }
  }, []);
  return { status: snapshot, checkNow: checkUpstreamTrackerNow };
}
