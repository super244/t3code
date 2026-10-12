/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=15m; seat=antigravity; date=2026-10-01 */
import { isProviderAvailable, type ModelSelection, type ServerProvider } from "@t3tools/contracts";

export const MISSION_RECIPES = [
  { id: "custom", label: "Custom task", prompt: "" },
  {
    id: "implement",
    label: "Build a feature",
    prompt:
      "Implement the following feature in this project: [describe the outcome]. Read the project instructions, preserve existing work, and verify the behavior with focused checks.",
  },
  {
    id: "debug",
    label: "Investigate a bug",
    prompt:
      "Investigate this problem: [describe the observed and expected behavior]. Reproduce it, identify the cause, make a focused fix, and verify it. Preserve unrelated work.",
  },
  {
    id: "review",
    label: "Review changes",
    prompt:
      "Review the current changes in this project for correctness, regressions, and missing verification. Report actionable findings with file references. Do not modify files.",
  },
  {
    id: "refactor",
    label: "Refactor & Clean",
    prompt:
      "Refactor and clean up the selected component or module: [target path/module]. Improve code clarity, eliminate duplication, and preserve all existing behavior. Verify with project tests.",
  },
  {
    id: "security",
    label: "Security Audit",
    prompt:
      "Perform a security and safety audit on this project's dependencies, authorization boundaries, and input handling. Report vulnerabilities or regressions and implement precise remediations.",
  },
  {
    id: "optimize",
    label: "Optimize Performance",
    prompt:
      "Profile and optimize the selected routine or component: [target path/function]. Minimize latency, reduce unnecessary re-renders or allocations, and benchmark the result.",
  },
  {
    id: "tests",
    label: "Generate Test Suite",
    prompt:
      "Analyze the target module: [target path/module]. Identify edge cases, error conditions, and regressions. Write comprehensive automated unit/integration tests following project conventions.",
  },
] as const;

export function missionProviders(providers: ReadonlyArray<ServerProvider>): ServerProvider[] {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      isProviderAvailable(provider) &&
      provider.status === "ready" &&
      provider.models.length > 0,
  );
}

/** Resolve within one environment: identical instance IDs on another computer are unrelated. */
export function missionModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  preferred: ModelSelection | null | undefined,
  requireExactSelection = false,
): ModelSelection | null {
  const available = missionProviders(providers);
  if (requireExactSelection) {
    const provider = available.find((item) => item.instanceId === preferred?.instanceId);
    return preferred && provider?.models.some((item) => item.slug === preferred.model)
      ? { instanceId: provider.instanceId, model: preferred.model }
      : null;
  }
  const provider =
    available.find((item) => item.instanceId === preferred?.instanceId) ?? available[0];
  if (!provider) return null;
  const model =
    provider.models.find((item) => item.slug === preferred?.model) ??
    provider.models.find((item) => item.isDefault) ??
    provider.models[0];
  return model ? { instanceId: provider.instanceId, model: model.slug } : null;
}
