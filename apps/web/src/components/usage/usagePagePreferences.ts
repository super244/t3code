/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-01 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=5m; seat=antigravity; date=2026-10-02 */
import * as Schema from "effect/Schema";
import { UsageProviderKind } from "@t3tools/contracts";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";

const STORAGE_KEY = "t3code:usage-page-preferences:v1";
const UsagePagePreferencesSchema = Schema.Struct({
  provider: Schema.optional(Schema.NullOr(UsageProviderKind)),
  metric: Schema.Literals(["cost", "tokens", "limits"]),
  windowPreset: Schema.Literals([
    "1h",
    "5h",
    "12h",
    "24h",
    "3d",
    "7d",
    "30d",
    "90d",
    "180d",
    "1y",
    "2y",
    "5y",
    "all",
  ]),
  monthlyBudgetUsd: Schema.optional(Schema.NullOr(Schema.Number)),
});
export type UsagePagePreferences = typeof UsagePagePreferencesSchema.Type;

export function readUsagePagePreferences(): UsagePagePreferences {
  try {
    return (
      getLocalStorageItem(STORAGE_KEY, UsagePagePreferencesSchema) ?? {
        metric: "cost",
        windowPreset: "30d",
      }
    );
  } catch (error) {
    console.error("Could not read Usage page preferences.", error);
    return { metric: "cost", windowPreset: "30d" };
  }
}

export function saveUsagePagePreferences(preferences: UsagePagePreferences): void {
  try {
    setLocalStorageItem(STORAGE_KEY, preferences, UsagePagePreferencesSchema);
  } catch (error) {
    console.error("Could not save Usage page preferences.", error);
  }
}
