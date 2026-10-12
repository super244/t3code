/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import * as Schema from "effect/Schema";
export const PrismBridgeStatus = Schema.Struct({
  synced: Schema.Boolean,
  activeThemeId: Schema.NullOr(Schema.String),
  activeThemeName: Schema.NullOr(Schema.String),
  lastSyncedAt: Schema.NullOr(Schema.String),
  settingsPath: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type PrismBridgeStatus = typeof PrismBridgeStatus.Type;
