/* agent-watermark: model=haiku-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-12 */
/**
 * The one idle placeholder for the composer, shared by every breakpoint and connection state
 * so phone and desktop never describe the input differently. It names only what the composer
 * does: free text, @file mentions, and / commands.
 */
export const COMPOSER_PLACEHOLDER = "Ask anything, @tag files, or / for commands";

/** Kept as an alias because settings previews render the same placeholder. */
export const DISCONNECTED_COMPOSER_PLACEHOLDER = COMPOSER_PLACEHOLDER;
