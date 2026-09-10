import type { RoutineRunStatus } from "@t3tools/contracts";

export const ROUTINE_STATUS: Record<
  RoutineRunStatus,
  { readonly label: string; readonly variant: "secondary" | "info" | "success" | "error" }
> = {
  never: { label: "Not run", variant: "secondary" },
  running: { label: "Starting", variant: "info" },
  launched: { label: "Launched", variant: "success" },
  failed: { label: "Failed", variant: "error" },
};

export function formatRoutineTime(value: string | null): string {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function routineConfigurationIssue(input: {
  readonly projectAvailable: boolean;
  readonly providerAvailable: boolean;
  readonly modelAvailable: boolean;
  readonly timeZone: string;
}): string | null {
  if (!input.projectAvailable) {
    return "This project is no longer available. Choose another project.";
  }
  if (!input.providerAvailable) {
    return "This provider subscription is unavailable. Choose an active subscription.";
  }
  if (!input.modelAvailable) {
    return "This model is no longer available. Choose another model.";
  }
  if (!isValidTimeZone(input.timeZone)) {
    return "Enter a valid IANA time zone, such as America/Vancouver.";
  }
  return null;
}
