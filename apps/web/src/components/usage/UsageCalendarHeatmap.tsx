/* agent-watermark: model=opus-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-12 */
/* agent-watermark: model=opus-5.5; effort=high; duration=12m; seat=claude-code; date=2026-10-10 */
/* agent-watermark: model=opus-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-11 */
import type { DailyTotals } from "@t3tools/shared/usageMerge";
import { formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { useMemo, useState } from "react";
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
  const totalWeeks = Math.round((end.getTime() - start.getTime()) / (7 * 86_400_000)) + 1;
  for (let w = 0; w < totalWeeks; w += 1) {
    const week: HeatCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      const cursor = new Date(start.getTime() + (w * 7 + i) * 86_400_000);
      const day = utcToDay(cursor);
      const inRange = day >= first && day <= last;
      const value = inRange ? (valueOf.get(day) ?? 0) : 0;
      // Square-root scaling keeps a single expensive day from flattening the rest to one shade.
      const level =
        value > 0 && peak > 0
          ? Math.min(4, Math.max(1, Math.ceil(Math.sqrt(value / peak) * 4)))
          : 0;
      if (inRange) byWeekday[i] = (byWeekday[i] ?? 0) + value;
      week.push({ day, value, level, inRange });
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

  // A month's name sits above the first week that holds its 1st (and above the first week shown).
  const months = weeks.map((week, w) => {
    const opener = week.find((cell) => cell.inRange && (w === 0 || cell.day.endsWith("-01")));
    if (!opener) return undefined;
    return dayToUtc(opener.day).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
  });
  // The first week's label is only a partial month; drop it when the next month's name lands
  // within two columns, or the two print over each other ("Mar Apr").
  if (months[0] && months.slice(1, 3).some(Boolean)) months[0] = undefined;

  return {
    weeks,
    months,
    activeDays,
    totalDays: sorted.length,
    lastDay: last,
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
  const [hovered, setHovered] = useState<HeatCell | undefined>(undefined);
  if (!heat || heat.totalDays < 7) return null;

  return (
    <section className="flex flex-col gap-3" aria-label="Daily usage calendar">
      <h2 className="text-sm font-medium text-foreground">Activity calendar</h2>
      {/* The heatmap and what it adds up to sit side by side; the figures used to trail the
          heading as one run-on line at the far edge of an otherwise empty row. */}
      <div className="grid items-start gap-x-10 gap-y-5 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          {/* One grid: weekday labels, then a column per week that grows to fill the card up to
          a cap, so a 30-day window does not balloon and a year still fits without scrolling. */}
          <div className="overflow-x-auto pb-1">
            <div
              className="grid gap-[3px] text-[10px] leading-none text-muted-foreground"
              style={{
                gridTemplateColumns: `auto repeat(${heat.weeks.length}, minmax(9px, 1fr))`,
                maxWidth: `calc(2.25rem + ${heat.weeks.length} * 26px)`,
              }}
              role="grid"
              aria-readonly="true"
              onMouseLeave={() => setHovered(undefined)}
            >
              <span aria-hidden="true" />
              {heat.months.map((month, w) => (
                <span
                  key={`m-${heat.weeks[w]?.[0]?.day}`}
                  aria-hidden="true"
                  className="h-3 overflow-visible whitespace-nowrap"
                >
                  {month ?? ""}
                </span>
              ))}
              {WEEKDAYS.map((label, row) => (
                <div key={label} role="row" className="contents">
                  <span
                    aria-hidden="true"
                    className={cn("self-center pr-1.5", row % 2 === 1 ? "opacity-0" : "")}
                  >
                    {label}
                  </span>
                  {heat.weeks.map((week) => {
                    const cell = week[row];
                    if (!cell) return null;
                    return (
                      <span
                        key={cell.day}
                        role="gridcell"
                        onMouseEnter={cell.inRange ? () => setHovered(cell) : undefined}
                        aria-label={
                          cell.inRange
                            ? `${formatCellDay(cell.day)}, ${cell.value > 0 ? formatValue(cell.value, metric) : "no usage"}`
                            : undefined
                        }
                        className={cn(
                          "aspect-square w-full rounded-[3px] transition-[box-shadow] duration-100",
                          cell.inRange ? LEVEL_CLASS[cell.level] : "bg-transparent",
                          cell.inRange && "hover:ring-1 hover:ring-foreground/50",
                          cell.day === heat.lastDay && "ring-1 ring-foreground/40",
                        )}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>Less</span>
            {LEVEL_CLASS.map((cls) => (
              <span key={cls} className={cn("size-[11px] rounded-[3px]", cls)} aria-hidden="true" />
            ))}
            <span>More</span>
            <span className="ml-3 text-foreground/80 tabular-nums" aria-live="polite">
              {hovered
                ? `${formatCellDay(hovered.day)} · ${hovered.value > 0 ? formatValue(hovered.value, metric) : "no usage"}`
                : ""}
            </span>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          <CalendarFigure label="Active days" value={`${heat.activeDays} of ${heat.totalDays}`} />
          <CalendarFigure
            label="Current streak"
            value={heat.streak > 0 ? `${heat.streak} ${heat.streak === 1 ? "day" : "days"}` : "—"}
          />
          <CalendarFigure label="Busiest weekday" value={heat.busiestWeekday ?? "—"} />
          <CalendarFigure
            label="Peak day"
            value={heat.peakDay ? formatValue(heat.peak, metric) : "—"}
            detail={heat.peakDay ? formatCellDay(heat.peakDay) : undefined}
          />
        </dl>
      </div>
    </section>
  );
}

function CalendarFigure({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-medium text-foreground tabular-nums">{value}</dd>
      {detail ? <dd className="text-xs text-muted-foreground">{detail}</dd> : null}
    </div>
  );
}
