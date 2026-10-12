/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=5m; seat=codex; date=2026-10-02 */
import { makeAllHistoryWindow, makeWindow } from "@t3tools/shared/usageFormat";

// Labels are abbreviated to share a row with the metric toggle; screen
// readers get the full phrase.
export const WINDOW_OPTIONS = [
  { value: "1h", amount: 1, resolution: "hour", label: "1h", accessibilityLabel: "Past hour" },
  { value: "5h", amount: 5, resolution: "hour", label: "5h", accessibilityLabel: "Past 5 hours" },
  {
    value: "12h",
    amount: 12,
    resolution: "hour",
    label: "12h",
    accessibilityLabel: "Past 12 hours",
  },
  {
    value: "24h",
    amount: 24,
    resolution: "hour",
    label: "24h",
    accessibilityLabel: "Past 24 hours",
  },
  { value: "3d", amount: 3, resolution: "day", label: "3d", accessibilityLabel: "Past 3 days" },
  { value: "7d", amount: 7, resolution: "day", label: "7d", accessibilityLabel: "Past 7 days" },
  { value: "30d", amount: 30, resolution: "day", label: "30d", accessibilityLabel: "Past 30 days" },
  { value: "90d", amount: 90, resolution: "day", label: "90d", accessibilityLabel: "Past 90 days" },
  {
    value: "180d",
    amount: 180,
    resolution: "day",
    label: "180d",
    accessibilityLabel: "Past 180 days",
  },
  { value: "1y", amount: 365, resolution: "day", label: "1y", accessibilityLabel: "Past year" },
  { value: "2y", amount: 730, resolution: "day", label: "2y", accessibilityLabel: "Past 2 years" },
  {
    value: "5y",
    amount: 1_825,
    resolution: "day",
    label: "5y",
    accessibilityLabel: "Past 5 years",
  },
  {
    value: "all",
    amount: null,
    resolution: "day",
    label: "All",
    accessibilityLabel: "All usage history",
  },
] as const;

export type UsageWindowPreset = (typeof WINDOW_OPTIONS)[number]["value"];

export function usageWindowOption(value: UsageWindowPreset) {
  return WINDOW_OPTIONS.find((option) => option.value === value) ?? WINDOW_OPTIONS[6];
}

export function makeUsageWindow(value: UsageWindowPreset, now = new Date()) {
  const option = usageWindowOption(value);
  if (option.amount === null) return makeAllHistoryWindow(now);
  return makeWindow(option.amount, now, option.resolution);
}
