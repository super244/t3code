/* agent-watermark: model=haiku-5.5; effort=high; duration=30m; seat=claude-code; date=2026-10-13 */
export const RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 980px)";
// Applied only while a floating preview overlaps the compact sheet.
export const RIGHT_PANEL_SHEET_LAYER_CLASS_NAME = "z-[35]";
// Phones get a full-width sheet: a narrower one left a sliver of undimmed chat
// beside it, and its own tab bar keeps the panel toggle reachable to close it.
export const RIGHT_PANEL_SHEET_CLASS_NAME =
  "w-[min(42vw,28rem)] min-w-80 max-w-[28rem] p-0 max-[760px]:w-full max-[760px]:max-w-none max-[760px]:min-w-0 wco:mt-[env(titlebar-area-height)] wco:h-[calc(100%-env(titlebar-area-height))] wco:max-h-[calc(100%-env(titlebar-area-height))]";
