import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ServerConfig } from "@t3tools/contracts";

export interface MobileCommandCenterSummary {
  readonly active: number;
  readonly attention: number;
  readonly readyProviders: number;
  readonly totalProviders: number;
  readonly routines: number;
}

export function buildMobileCommandCenterSummary(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  serverConfigs: ReadonlyMap<unknown, ServerConfig>,
): MobileCommandCenterSummary {
  const visible = threads.filter((thread) => thread.archivedAt === null);
  const providers = [...serverConfigs.values()].flatMap((config) =>
    config.providers.filter((provider) => provider.enabled),
  );
  return {
    active: visible.filter(
      (thread) =>
        thread.session?.status === "running" ||
        thread.session?.status === "starting" ||
        thread.backgroundLiveness === "working" ||
        thread.backgroundLiveness === "monitoring",
    ).length,
    attention: visible.filter(
      (thread) =>
        thread.hasPendingApprovals ||
        thread.hasPendingUserInput ||
        thread.session?.status === "error",
    ).length,
    readyProviders: providers.filter(
      (provider) => provider.installed && provider.status === "ready",
    ).length,
    totalProviders: providers.length,
    routines: [...serverConfigs.values()].reduce(
      (total, config) =>
        total + Object.values(config.settings.routines).filter((routine) => routine.enabled).length,
      0,
    ),
  };
}
