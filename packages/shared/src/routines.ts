/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=15m; seat=codex; date=2026-10-10 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=29m; seat=codex; date=2026-10-09 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=30m; seat=codex; date=2026-10-08 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=35m; seat=codex; date=2026-10-02 */
import {
  RoutineConfiguration,
  MAX_ROUTINE_RUN_HISTORY,
  type RoutineDefinition,
  type RoutineRunReceipt,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Cron } from "croner";

const equivalent = Schema.toEquivalence(RoutineConfiguration);

/** Newest first; only the scheduler creates occurrence receipts. */
export function appendRoutineRun(
  routine: RoutineDefinition,
  receipt: RoutineRunReceipt,
): RoutineDefinition {
  return {
    ...routine,
    runHistory: [receipt, ...(routine.runHistory ?? [])].slice(0, MAX_ROUTINE_RUN_HISTORY),
  };
}

/** Patch the claimed occurrence without recreating receipts absent on older servers. */
export function finishRoutineRun(
  routine: RoutineDefinition,
  startedAt: string,
  patch: Pick<RoutineRunReceipt, "updatedAt" | "status" | "threadId" | "error"> &
    Partial<Pick<RoutineRunReceipt, "launchSequence">>,
): RoutineDefinition {
  if (!routine.runHistory) return routine;
  return {
    ...routine,
    runHistory: routine.runHistory.map((receipt) =>
      receipt.startedAt === startedAt && receipt.status === "running"
        ? { ...receipt, ...patch }
        : receipt,
    ),
  };
}

/** Replay only after this launch. A later user turn never becomes its outcome. */
export function observeRoutineTurn(
  receipt: RoutineRunReceipt,
  events: ReadonlyArray<OrchestrationEvent>,
): RoutineRunReceipt {
  if (
    receipt.status !== "launched" ||
    !receipt.threadId ||
    receipt.launchSequence === undefined ||
    receipt.outcome
  )
    return receipt;
  const result = { ...receipt };
  let changed = false;
  for (const event of events) {
    if (event.sequence <= (result.observedSequence ?? result.launchSequence ?? 0)) continue;
    if (event.aggregateId !== receipt.threadId) continue;
    result.observedSequence = event.sequence;
    changed = true;
    const unknown = (reason: string): RoutineRunReceipt => ({
      ...result,
      outcome: {
        status: "unknown",
        turnId: result.turnId ?? null,
        recordedAt: event.occurredAt,
        eventSequence: event.sequence,
        reason,
      },
    });
    if (event.type === "thread.turn-start-requested")
      return unknown(
        "Another turn was requested before a terminal event for the routine's first turn was recorded. Open the thread to review it.",
      );
    if (event.type !== "thread.session-set") continue;
    const session = event.payload.session;
    if (session.status === "running" && session.activeTurnId !== null) {
      if (result.turnId && result.turnId !== session.activeTurnId)
        return unknown(
          "A different turn began before a terminal event for the routine turn was recorded.",
        );
      result.turnId = session.activeTurnId;
      continue;
    }
    if (session.activeTurnId !== null && result.turnId && session.activeTurnId !== result.turnId)
      return unknown(
        "This session event belongs to a different turn; it cannot establish the routine outcome.",
      );
    const status =
      session.status === "error"
        ? "failed"
        : session.status === "interrupted" || session.status === "stopped"
          ? "interrupted"
          : (session.status === "ready" || session.status === "idle") && result.turnId
            ? "completed"
            : null;
    if (status)
      return {
        ...result,
        outcome: {
          status,
          turnId: result.turnId ?? null,
          recordedAt: session.updatedAt,
          eventSequence: event.sequence,
          reason: status === "failed" ? (session.lastError?.slice(0, 2_000) ?? null) : null,
        },
      };
  }
  return changed ? result : receipt;
}

function normalized(routine: RoutineConfiguration): RoutineConfiguration {
  const options = new Map(
    (routine.modelSelection.options ?? []).map(({ id, value }) => [id, value]),
  );
  return {
    ...routine,
    catchUp: routine.catchUp !== false,
    overlapPolicy: routine.overlapPolicy ?? "allow",
    dailyLaunchLimit: routine.dailyLaunchLimit ?? null,
    modelSelection: {
      ...routine.modelSelection,
      options: [...options]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, value]) => ({ id, value })),
    },
  };
}

/** Compare configuration semantically, ignoring receipts and provider-option ordering. */
export function sameRoutineConfiguration(
  left: RoutineConfiguration,
  right: RoutineConfiguration,
): boolean {
  return equivalent(normalized(left), normalized(right));
}

const timeZoneIssue = "Enter a valid IANA time zone, such as America/Vancouver.";

/** The counter is independent of bounded receipt history and advances under the settings lock. */
export function routineDailyLaunchUsage(routine: RoutineDefinition, now: Date) {
  const timeZone = routine.timeZone.trim();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const previous = routine.dailyLaunchUsage;
  return {
    day,
    timeZone,
    attempts: previous?.day === day && previous.timeZone === timeZone ? previous.attempts : 0,
  };
}

/** Bounded retained task identities, including the last task from older receipts. */
export function routineTaskIds(routine: RoutineDefinition) {
  return [
    ...new Set([
      ...(routine.lastThreadId ? [routine.lastThreadId] : []),
      ...(routine.runHistory ?? []).flatMap((receipt) =>
        receipt.threadId ? [receipt.threadId] : [],
      ),
    ]),
  ].sort();
}
const cronIssue =
  "Enter a valid cron expression with five, six or seven fields, such as 0 7 * * *.";

function parsedSchedule(cron: string, timeZone: string): Cron {
  const zone = timeZone.trim();
  new Intl.DateTimeFormat(undefined, { timeZone: zone }).format(0);
  const schedule = new Cron(cron.trim(), { timezone: zone, paused: true });
  if (schedule.getPattern() === undefined) {
    schedule.stop();
    throw new Error(cronIssue);
  }
  return schedule;
}

/** Syntax only: future-occurrence validation uses the environment's clock on the server. */
export function routineScheduleIssue(cron: string, timeZone: string): string | null {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timeZone.trim() }).format(0);
  } catch {
    return timeZoneIssue;
  }
  try {
    const schedule = parsedSchedule(cron, timeZone);
    schedule.stop();
    return null;
  } catch {
    return cronIssue;
  }
}

/** Return null after a finite schedule's last occurrence; no timers or callbacks are started. */
export function nextRoutineOccurrence(cron: string, timeZone: string, after: Date): string | null {
  const schedule = parsedSchedule(cron, timeZone);
  try {
    return schedule.nextRun(after)?.toISOString() ?? null;
  } finally {
    schedule.stop();
  }
}

/** Preview uses the same parser as the scheduler and never starts timers. */
export function previewRoutineOccurrences(
  cron: string,
  timeZone: string,
  after: Date,
  count = 5,
): string[] {
  const schedule = parsedSchedule(cron, timeZone);
  const dates: string[] = [];
  try {
    let cursor = after;
    for (let index = 0; index < Math.max(0, Math.min(count, 10)); index += 1) {
      const next = schedule.nextRun(cursor);
      if (next === null || next.getTime() <= cursor.getTime()) break;
      dates.push(next.toISOString());
      cursor = next;
    }
    return dates;
  } finally {
    schedule.stop();
  }
}
