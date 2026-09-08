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
