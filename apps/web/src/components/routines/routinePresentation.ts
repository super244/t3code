/* agent-watermark: model=grok-4.7; effort=default; duration=18m; seat=cursor; date=2026-09-30 */
import type { RoutineRunStatus } from "@t3tools/contracts";

import { routineScheduleLabel } from "./routinePresets";

export const ROUTINE_STATUS: Record<
  RoutineRunStatus,
  { readonly label: string; readonly variant: "secondary" | "info" | "success" | "error" }
> = {
  never: { label: "Not run", variant: "secondary" },
  running: { label: "Starting", variant: "info" },
  launched: { label: "Launched", variant: "success" },
  failed: { label: "Failed", variant: "error" },
};

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** One line for the routine list: schedule, then the next thing worth knowing. */
export function routineListSubtitle(input: {
  readonly cron: string;
  readonly enabled: boolean;
  readonly nextRunAt: string | null;
  readonly lastRunStatus: RoutineRunStatus;
  readonly lastError: string | null;
  readonly now?: number;
}): string {
  const schedule = routineScheduleLabel(input.cron);
  if (!input.enabled) return `Paused · ${schedule}`;
  if (input.lastRunStatus === "failed") {
    const error = input.lastError?.trim() ?? "";
    if (error.length === 0) return `${schedule} · Last run failed`;
    const brief = error.length > 72 ? `${error.slice(0, 69)}…` : error;
    return `${schedule} · ${brief}`;
  }
  const next = input.nextRunAt === null ? Number.NaN : Date.parse(input.nextRunAt);
  if (!Number.isFinite(next)) return schedule;
  const delta = next - (input.now ?? Date.now());
  if (delta <= 60_000) return `${schedule} · Due now`;
  if (delta < 60 * 60 * 1000) {
    return `${schedule} · in ${countPhrase(Math.round(delta / 60_000), "min", "min")}`;
  }
  if (delta < 24 * 60 * 60 * 1000) {
    return `${schedule} · in ${countPhrase(Math.round(delta / (60 * 60 * 1000)), "hr", "hr")}`;
  }
  return `${schedule} · in ${countPhrase(Math.round(delta / (24 * 60 * 60 * 1000)), "day", "days")}`;
}

export function formatRoutineTime(value: string | null): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function routineConfigurationIssue(input: {
  readonly projectAvailable: boolean;
  readonly providerAvailable: boolean;
  readonly modelAvailable: boolean;
  readonly timeZone: string;
}): string | null {
  if (!input.projectAvailable) {
    return "This project is no longer available. Choose another project.";
  }
  if (!input.providerAvailable) {
    return "This provider subscription is unavailable. Choose an active subscription.";
  }
  if (!input.modelAvailable) {
    return "This model is no longer available. Choose another model.";
  }
  if (!isValidTimeZone(input.timeZone)) {
    return "Enter a valid IANA time zone, such as America/Vancouver.";
  }
  return null;
}
