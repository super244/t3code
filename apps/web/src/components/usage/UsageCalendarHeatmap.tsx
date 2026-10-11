/* agent-watermark: model=opus-5.5; effort=high; duration=12m; seat=claude-code; date=2026-10-10 */
import type { DailyTotals } from "@t3tools/shared/usageMerge";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { useMemo } from "react";
import { cn } from "../../lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const LEVEL_CLASS = [
  "bg-muted/60",
  "bg-primary/20",
  "bg-primary/40",
  "bg-primary/65",
  "bg-primary",
] as const;

interface HeatCell {
  readonly day: string;
  readonly value: number;
  readonly level: number;
  readonly inRange: boolean;
}

/** Parses a `YYYY-MM-DD` usage day as a UTC calendar date, so weekday math never drifts with the viewer's zone. */
function dayToUtc(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function utcToDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Monday-first weekday index (0 = Monday). */
function weekdayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

export function buildHeatmap(
  days: readonly string[],
  daily: readonly DailyTotals[],
  metric: "cost" | "tokens",
) {
  const sorted = [...days].sort();
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return undefined;

  const valueOf = new Map(
    daily.map((entry) => [entry.day, metric === "tokens" ? entry.totalTokens : entry.costUsd]),
  );
  const values = sorted.map((day) => valueOf.get(day) ?? 0).filter((v) => v > 0);
  const peak = values.length ? Math.max(...values) : 0;

  const start = dayToUtc(first);
  start.setUTCDate(start.getUTCDate() - weekdayIndex(start));
  const end = dayToUtc(last);
  end.setUTCDate(end.getUTCDate() + (6 - weekdayIndex(end)));

  const weeks: HeatCell[][] = [];
  const byWeekday = Array.from({ length: 7 }, () => 0);
  for (let cursor = new Date(start); cursor <= end;) {
    const week: HeatCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      const day = utcToDay(cursor);
      const inRange = day >= first && day <= last;
      const value = inRange ? (valueOf.get(day) ?? 0) : 0;
      // Square-root scaling keeps a single expensive day from flattening the rest to one shade.
      const level =
        value > 0 && peak > 0
          ? Math.min(4, Math.max(1, Math.ceil(Math.sqrt(value / peak) * 4)))
          : 0;
      if (inRange) byWeekday[weekdayIndex(cursor)] = (byWeekday[weekdayIndex(cursor)] ?? 0) + value;
      week.push({ day, value, level, inRange });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }

  let streak = 0;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if ((valueOf.get(sorted[i] ?? "") ?? 0) > 0) streak += 1;
    else break;
  }
  const busiestIndex = byWeekday.reduce((best, v, i, all) => (v > (all[best] ?? 0) ? i : best), 0);
  const activeDays = values.length;
  const peakDay = sorted.find((day) => (valueOf.get(day) ?? 0) === peak && peak > 0);

  return {
    weeks,
    activeDays,
    totalDays: sorted.length,
    streak,
    busiestWeekday: (byWeekday[busiestIndex] ?? 0) > 0 ? WEEKDAYS[busiestIndex] : undefined,
    peak,
    peakDay,
  };
}

function formatValue(value: number, metric: "cost" | "tokens") {
  return metric === "tokens" ? `${formatTokens(value)} tokens` : formatUsd(value);
}

function formatCellDay(day: string) {
  return dayToUtc(day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Calendar heatmap of daily usage: one square per day, Monday-first columns of weeks. */
export function UsageCalendarHeatmap({
  days,
  daily,
  metric,
}: {
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly metric: "cost" | "tokens";
}) {
  const heat = useMemo(() => buildHeatmap(days, daily, metric), [days, daily, metric]);
  if (!heat || heat.totalDays < 7) return null;

  return (
    <section className="flex flex-col gap-3" aria-label="Daily usage calendar">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Activity calendar</h2>
        <p className="text-xs text-muted-foreground">
          {heat.activeDays} of {heat.totalDays} days active
          {heat.streak > 1 ? ` · ${heat.streak}-day streak` : ""}
          {heat.busiestWeekday ? ` · busiest on ${heat.busiestWeekday}` : ""}
          {heat.peakDay
            ? ` · peak ${formatValue(heat.peak, metric)} on ${formatCellDay(heat.peakDay)}`
            : ""}
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <div className="grid shrink-0 grid-rows-7 gap-[3px] pt-px text-[10px] leading-[11px] text-muted-foreground">
          {WEEKDAYS.map((label, i) => (
            <span key={label} className={cn("h-[11px]", i % 2 === 1 ? "opacity-0" : "")}>
              {label}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px]" role="grid" aria-readonly="true">
          {heat.weeks.map((week) => (
            <div key={week[0]?.day} className="grid grid-rows-7 gap-[3px]" role="row">
              {week.map((cell) => (
                <span
                  key={cell.day}
                  role="gridcell"
                  title={
                    cell.inRange
                      ? `${formatCellDay(cell.day)}: ${cell.value > 0 ? formatValue(cell.value, metric) : "no usage"}`
                      : undefined
                  }
                  aria-label={
                    cell.inRange
                      ? `${formatCellDay(cell.day)}, ${cell.value > 0 ? formatValue(cell.value, metric) : "no usage"}`
                      : undefined
                  }
                  className={cn(
                    "size-[11px] rounded-[2px]",
                    cell.inRange ? LEVEL_CLASS[cell.level] : "bg-transparent",
                  )}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>Less</span>
        {LEVEL_CLASS.map((cls) => (
          <span key={cls} className={cn("size-[11px] rounded-[2px]", cls)} aria-hidden="true" />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}
