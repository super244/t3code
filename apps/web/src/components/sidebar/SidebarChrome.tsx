/* agent-watermark: model=haiku-5.5; effort=high; duration=40m; seat=claude-code; date=2026-10-12 */
/* agent-watermark: model=opus-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-12 */
/* agent-watermark: model=opus-5.5; effort=high; duration=4m; seat=claude-code; date=2026-10-10 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=15m; seat=antigravity; date=2026-10-10 */
/* agent-watermark: model=opus-5.5; effort=high; duration=45m; seat=claude-code; date=2026-10-04 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
/* agent-watermark: model=muse-spark; effort=high; duration=90m; seat=opencode; date=2026-10-07 */
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  ChartNoAxesColumnIcon,
  FlagIcon,
  GitPullRequestIcon,
  LayoutDashboardIcon,
  MoreHorizontalIcon,
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import { T3Wordmark } from "../T3Wordmark";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { UpstreamUpdatePill } from "../updates/UpstreamUpdatePill";
import { useUpstreamTracker } from "../updates/upstreamTracker";
import { SoundControlPill } from "../sound/SoundControlPill";
import { PrismThemeSwitcher } from "../themes/PrismThemeSwitcher";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  // The stage texture is an accent only: it sits faintly behind the top corner and the
  // wordmark itself stays on the neutral sidebar surface.
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode === "artwork",
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? (
        <div className="pointer-events-none absolute inset-0 z-0 hidden opacity-30 [mask-image:linear-gradient(to_right,black_0%,transparent_80%)] md:block">
          <SidebarStageBackdrop variant={backdropVariant} />
        </div>
      ) : null}
      <SidebarTrigger className="relative z-10 md:hidden" />
      <SidebarBrand />
      {pillLabel ? (
        <Badge
          className="relative z-10 ml-1 hidden rounded-full px-1.5 text-muted-foreground @[15rem]/sidebar-header:inline-flex"
          data-environment-identification="pill"
          size="sm"
          variant="secondary"
        >
          {pillLabel}
        </Badge>
      ) : null}
    </SidebarHeader>
  );
});

function SidebarBrand() {
  return (
    <Link
      aria-label="Go to threads"
      className="relative z-10 ml-[var(--workspace-titlebar-content-left)] hidden h-7 w-fit min-w-0 shrink-0 items-center overflow-hidden rounded-md text-foreground outline-hidden ring-ring focus-visible:ring-2 md:flex"
      to="/"
    >
      <span className="inline-flex min-w-0 items-baseline gap-1">
        <T3Wordmark aria-label="T3" className="h-2.5 w-auto shrink-0" />
        <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
          Code
        </span>
      </span>
    </Link>
  );
}

function SidebarUtilityItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

function SidebarUtilityDivider() {
  return (
    <SidebarMenuItem className="flex shrink-0 items-center px-0.5" aria-hidden>
      <span className="h-4 w-px bg-border/80" />
    </SidebarMenuItem>
  );
}

export const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const { isMobile, setOpenMobile } = useSidebar();
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const { environments } = useEnvironments();
  // The page reads every connected server, so one of them offering pull requests is enough for
  // the link to lead somewhere.
  const pullRequestsSupported = environments.some(
    (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
  );
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);
  const handlePullRequestsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  }, [closeMobileSidebar, navigate]);
  const handleSettingsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  }, [closeMobileSidebar, navigate]);

  const handleUsageClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  }, [isMobile, navigate, setOpenMobile]);
  const handleCommandCenterClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/command-center" });
  }, [closeMobileSidebar, navigate]);
  const handleRoutinesClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/routines" });
  }, [closeMobileSidebar, navigate]);

  const handleRaceClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/race" });
  }, [closeMobileSidebar, navigate]);

  const handleBackClick = useCallback(() => {
    closeMobileSidebar();
    void navigateToMainApp();
  }, [closeMobileSidebar, navigateToMainApp]);

  return (
    <SidebarMenu className="flex-row items-center">
      {isOnUtilityPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>Back</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <>
          {/* Work surfaces first: where agents run, what is scheduled, and head-to-head runs. */}
          <SidebarUtilityItem
            icon={<LayoutDashboardIcon />}
            label="Command center"
            onClick={handleCommandCenterClick}
          />
          <SidebarUtilityItem
            icon={<CalendarClockIcon />}
            label="Routines"
            onClick={handleRoutinesClick}
          />
          <SidebarUtilityItem icon={<FlagIcon />} label="Race agents" onClick={handleRaceClick} />
          {/* Review and cost surfaces follow the work surfaces. */}
          {pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<GitPullRequestIcon />}
              label="Pull requests"
              onClick={handlePullRequestsClick}
            />
          ) : null}
          <SidebarUtilityItem
            icon={<ChartNoAxesColumnIcon />}
            label="Usage"
            onClick={handleUsageClick}
          />
          <SidebarUtilityDivider />
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label="Settings"
            onClick={handleSettingsClick}
          />
        </>
      )}
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

/**
 * One quiet footer menu for the app's own status and preferences (version, sound, theme). Each
 * control keeps its own pill, but the menu gives every one a heading so none reads as a bare
 * number or a bare theme name on the sidebar surface.
 */
function SidebarStatusMenu() {
  const { status } = useUpstreamTracker();
  const [open, setOpen] = useState(false);
  const version = `v${status.currentVersion}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`App status and preferences, ${version}`}
        className="inline-flex h-7 w-fit max-w-full items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        <MoreHorizontalIcon className="size-3.5 shrink-0" />
        <span className="font-mono tabular-nums">{version}</span>
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" className="w-72 p-3">
        <div className="flex flex-col gap-3">
          <StatusMenuRow label="Version">
            <UpstreamUpdatePill />
          </StatusMenuRow>
          <StatusMenuRow label="Sound">
            <SoundControlPill />
          </StatusMenuRow>
          <StatusMenuRow label="Theme">
            <PrismThemeSwitcher />
          </StatusMenuRow>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function StatusMenuRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const { status } = useUpstreamTracker();
  return (
    <SidebarFooter className="gap-1.5 p-[var(--sidebar-content-inset)]">
      {/* A new upstream release is worth seeing without opening the status menu. */}
      {status.hasNewRelease ? (
        <div className="flex min-w-0 items-center">
          <UpstreamUpdatePill />
        </div>
      ) : null}
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
      <SidebarStatusMenu />
    </SidebarFooter>
  );
});
