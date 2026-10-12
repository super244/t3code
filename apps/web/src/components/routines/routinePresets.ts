/* agent-watermark: model=haiku-5.5; effort=high; duration=12m; seat=claude-code; date=2026-10-12 */
export const ROUTINE_SCHEDULE_PRESETS = [
  { value: "0 * * * *", label: "Hourly" },
  { value: "0 7 * * *", label: "Daily at 7:00 AM" },
  { value: "0 9 * * 1-5", label: "Weekdays at 9:00 AM" },
  { value: "0 9 * * 1", label: "Weekly on Monday" },
  { value: "0 9 1 * *", label: "Monthly on the 1st" },
] as const;

export function routineScheduleLabel(cron: string): string {
  return ROUTINE_SCHEDULE_PRESETS.find((preset) => preset.value === cron)?.label ?? cron;
}

export function routineSchedulePreset(cron: string): string {
  return ROUTINE_SCHEDULE_PRESETS.some((preset) => preset.value === cron) ? cron : "custom";
}

/**
 * One example to start from. It imports as a paused draft through the same
 * template path as a pasted template, so the user reviews the prompt and
 * project before anything runs. Read-only by design: it asks for a summary and
 * changes nothing.
 */
export const ROUTINE_EXAMPLE_TEMPLATE = {
  format: "t3.routine-template/1",
  name: "Morning triage",
  cron: "0 9 * * 1-5",
  prompt:
    "Review open threads and pull requests for this project. List what needs a decision today, what is blocked, and what can wait. Do not change any files.",
  catchUp: false,
  overlapPolicy: "skip",
  runtimeMode: "approval-required",
  interactionMode: "default",
} as const;
