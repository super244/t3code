import { UsageDay, type UsageSummaryInput } from "@t3tools/contracts";
import { makeWindow } from "@t3tools/shared/usageFormat";

import type { UsagePagePreferences } from "./usagePagePreferences";

export type UsageWindowPreset = UsagePagePreferences["windowPreset"];

export const USAGE_WINDOW_OPTIONS = [
  { value: "1h", amount: 1, resolution: "hour", label: "1 hr" },
  { value: "5h", amount: 5, resolution: "hour", label: "5 hr" },
  { value: "12h", amount: 12, resolution: "hour", label: "12 hr" },
  { value: "24h", amount: 24, resolution: "hour", label: "24 hr" },
  { value: "3d", amount: 3, resolution: "day", label: "3 days" },
  { value: "7d", amount: 7, resolution: "day", label: "7 days" },
  { value: "30d", amount: 30, resolution: "day", label: "30 days" },
  { value: "90d", amount: 90, resolution: "day", label: "90 days" },
  { value: "180d", amount: 180, resolution: "day", label: "180 days" },
  { value: "1y", amount: 365, resolution: "day", label: "1 year" },
  { value: "2y", amount: 730, resolution: "day", label: "2 years" },
  { value: "5y", amount: 1_825, resolution: "day", label: "5 years" },
  { value: "all", amount: null, resolution: "day", label: "All" },
] as const;

export function usageWindowOption(value: UsageWindowPreset) {
  return USAGE_WINDOW_OPTIONS.find((option) => option.value === value) ?? USAGE_WINDOW_OPTIONS[6];
}

export function makeUsageWindow(value: UsageWindowPreset, now = new Date()): UsageSummaryInput {
  const option = usageWindowOption(value);
  if (option.amount !== null) return makeWindow(option.amount, now, option.resolution);

  const currentDay = makeWindow(1, now, "day");
  return {
    ...currentDay,
    // Provider transcript timestamps are Unix-era. This is a real all-time
    // boundary rather than an arbitrary rolling approximation.
    sinceDay: UsageDay.make("1970-01-01"),
  };
}
