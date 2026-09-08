import type { RoutineDefinition, ServerProvider } from "@t3tools/contracts";

export type CommandCenterThreadStatus =
  | "working"
  | "monitoring"
  | "approval"
  | "input"
  | "failed"
  | "ready";

export interface CommandCenterThreadLike {
  readonly archivedAt: string | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly backgroundLiveness?: "working" | "monitoring" | null | undefined;
  readonly session: { readonly status: string } | null;
}

export function commandCenterThreadStatus(
  thread: CommandCenterThreadLike,
): CommandCenterThreadStatus {
  if (thread.hasPendingApprovals) return "approval";
  if (thread.hasPendingUserInput) return "input";
  if (thread.session?.status === "running" || thread.session?.status === "starting") {
    return "working";
  }
  if (thread.session?.status === "error") return "failed";
  if (thread.backgroundLiveness === "working") return "working";
  if (thread.backgroundLiveness === "monitoring") return "monitoring";
  return "ready";
}

export interface CommandCenterSummary {
  readonly activeMissions: number;
  readonly attentionItems: number;
  readonly readyProviders: number;
  readonly totalProviders: number;
  readonly enabledRoutines: number;
  readonly failedRoutines: number;
}

export function buildCommandCenterSummary(input: {
  readonly threads: ReadonlyArray<CommandCenterThreadLike>;
  readonly providers: ReadonlyArray<Pick<ServerProvider, "enabled" | "installed" | "status">>;
  readonly routines: ReadonlyArray<Pick<RoutineDefinition, "enabled" | "lastRunStatus">>;
}): CommandCenterSummary {
  const visibleThreads = input.threads.filter((thread) => thread.archivedAt === null);
  const statuses = visibleThreads.map(commandCenterThreadStatus);
  const providers = input.providers.filter((provider) => provider.enabled);
  return {
    activeMissions: statuses.filter((status) => status === "working" || status === "monitoring")
      .length,
    attentionItems: statuses.filter(
      (status) => status === "approval" || status === "input" || status === "failed",
    ).length,
    readyProviders: providers.filter(
      (provider) => provider.installed && provider.status === "ready",
    ).length,
    totalProviders: providers.length,
    enabledRoutines: input.routines.filter((routine) => routine.enabled).length,
    failedRoutines: input.routines.filter((routine) => routine.lastRunStatus === "failed").length,
  };
}

export function sortUpcomingRoutines<
  T extends {
    readonly routine: Pick<RoutineDefinition, "enabled" | "name" | "nextRunAt">;
  },
>(routines: ReadonlyArray<T>): T[] {
  return [...routines].sort((left, right) => {
    if (left.routine.enabled !== right.routine.enabled) return left.routine.enabled ? -1 : 1;
    const leftTime = left.routine.nextRunAt ? Date.parse(left.routine.nextRunAt) : Infinity;
    const rightTime = right.routine.nextRunAt ? Date.parse(right.routine.nextRunAt) : Infinity;
    return leftTime - rightTime || left.routine.name.localeCompare(right.routine.name);
  });
}
