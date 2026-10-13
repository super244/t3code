/* agent-watermark: model=haiku-5.5; effort=high; duration=35m; seat=claude-code; date=2026-10-12 */
import { useEffect, type RefObject } from "react";

import { nextScanIndex, resolveScanKey, type ScanKeyTarget } from "./threadListScan.logic";

export const SIDEBAR_SCAN_ROW_SELECTOR = "[data-sidebar-thread-row]";

/** Elements with a layout box. Works for fixed-position sheets, where offsetParent is null. */
function isRendered(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * Window-level scan keys: "/" focuses the thread search when no text field has
 * focus and no earlier handler has claimed the key. On a thread page with the
 * page body focused, the composer takes "/" first, so it can start a slash
 * command. j/k or the arrows step between thread rows (Settled and Snoozed rows
 * included) while one holds focus. Enter needs no handler here because each row
 * already opens its thread on Enter.
 */
export function useSidebarScanKeys(searchInputRef: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const action = resolveScanKey({
        key: event.key,
        hasModifier: event.metaKey || event.ctrlKey || event.altKey,
        target: (event.target instanceof HTMLElement ? event.target : null) as ScanKeyTarget | null,
        focusOnRow: focused?.matches(SIDEBAR_SCAN_ROW_SELECTOR) === true,
      });
      if (action.type === "focus-search") {
        const input = searchInputRef.current;
        if (input === null || !isRendered(input)) return;
        event.preventDefault();
        input.focus();
        input.select();
        return;
      }
      if (action.type !== "move") return;
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(SIDEBAR_SCAN_ROW_SELECTOR),
      ).filter(isRendered);
      const next =
        rows[nextScanIndex(focused ? rows.indexOf(focused) : -1, rows.length, action.delta)];
      if (next === undefined) return;
      event.preventDefault();
      next.focus();
      next.scrollIntoView?.({ block: "nearest" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchInputRef]);
}
