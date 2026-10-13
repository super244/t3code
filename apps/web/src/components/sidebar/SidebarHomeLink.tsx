/* agent-watermark: model=haiku-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-12 */
import { useAtomValue } from "@effect/atom-react";
import { HomeIcon } from "lucide-react";
import { memo, useCallback } from "react";
import { Link, useLocation } from "@tanstack/react-router";

import { shortcutKeycapTokens } from "../CommandPalette.logic";
import { isLaunchpadPath } from "../launchpadRoute";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Kbd, KbdGroup } from "../ui/kbd";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";

/**
 * The launchpad's entry at the top of the sidebar. It is the one place that
 * shows the launchpad's shortcut next to its name, so the keycap teaches the
 * binding without a settings detour.
 */
export const SidebarHomeLink = memo(function SidebarHomeLink() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcutLabel = shortcutLabelForCommand(keybindings, "launchpad.open");
  const isActive = useLocation({ select: (location) => isLaunchpadPath(location.pathname) });
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          render={<Link to="/home" />}
          isActive={isActive}
          aria-current={isActive ? "page" : undefined}
          onClick={closeMobileSidebar}
          className="gap-2"
        >
          <HomeIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80" />
          <span className="min-w-0 flex-1 truncate">Home</span>
          {shortcutLabel ? (
            <KbdGroup
              className="hidden shrink-0 gap-0.5 pointer-fine:inline-flex"
              aria-label={`Shortcut ${shortcutLabel}`}
            >
              {shortcutKeycapTokens(shortcutLabel).map((token) => (
                <Kbd
                  key={token}
                  className="h-4.5 min-w-4.5 bg-sidebar-control-surface px-1 text-[0.7rem] leading-none text-sidebar-muted-foreground"
                >
                  {token}
                </Kbd>
              ))}
            </KbdGroup>
          ) : null}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
});
