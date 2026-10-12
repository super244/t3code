/* agent-watermark: model=opus-5.5; effort=high; duration=4m; seat=claude-code; date=2026-10-10 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import { useState, useEffect, useTransition, useRef } from "react";
import { PRISM_FLAGSHIP_THEMES, type PrismThemeDefinition } from "@t3tools/shared/themePalettes";
import { useTheme } from "../../hooks/useTheme";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { Check, RefreshCw } from "lucide-react";
import { playSound } from "../../lib/soundEffects";

import type { PrismBridgeStatus } from "@t3tools/shared/prismBridge";
import { requestPrismBridge } from "@t3tools/client-runtime/state/prism-bridge";
import * as Option from "effect/Option";
import { runtime } from "../../lib/runtime";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { usePreparedConnection } from "../../state/session";

export function PrismThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const environmentId = usePrimaryEnvironmentId();
  const prepared = Option.getOrNull(usePreparedConnection(environmentId));
  const [statusResult, setStatusResult] = useState<{
    connection: typeof prepared;
    status: PrismBridgeStatus;
  } | null>(null);
  const prismStatus = statusResult?.connection === prepared ? statusResult?.status : null;
  const [isSyncing, startSyncTransition] = useTransition();
  const [feedbackResult, setFeedbackResult] = useState<{
    connection: typeof prepared;
    message: string;
  } | null>(null);
  const syncFeedback = feedbackResult?.connection === prepared ? feedbackResult?.message : null;
  const currentPrepared = useRef(prepared);
  useEffect(() => {
    currentPrepared.current = prepared;
    let cancelled = false;
    if (isOpen && prepared) {
      void runtime
        .runPromise(requestPrismBridge(prepared, "status"))
        .then((data) => {
          if (!cancelled) setStatusResult({ connection: prepared, status: data });
        })
        .catch(() => {
          if (!cancelled)
            setFeedbackResult({
              connection: prepared,
              message: "Could not read sync status from this environment.",
            });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, prepared]);

  const activePrismTheme =
    PRISM_FLAGSHIP_THEMES.find((t) => t.id === theme) ||
    PRISM_FLAGSHIP_THEMES.find((t) => t.id === "prism-tide")!;

  const handleSyncWithPrism = () => {
    startSyncTransition(async () => {
      try {
        if (!prepared) throw new Error("Connect to an environment before syncing.");
        const data = await runtime.runPromise(requestPrismBridge(prepared, "sync"));
        if (currentPrepared.current !== prepared) return;
        setStatusResult({ connection: prepared, status: data });
        const syncedTheme = PRISM_FLAGSHIP_THEMES.find((item) => item.id === data.activeThemeId);
        if (!data.synced || !syncedTheme) {
          setFeedbackResult({
            connection: prepared,
            message: data.error || "The environment could not sync its Prism palette.",
          });
          return;
        }
        setTheme(syncedTheme.id);
        playSound("theme-switched");
        setFeedbackResult({ connection: prepared, message: `Synced: ${syncedTheme.label}` });
      } catch {
        if (currentPrepared.current !== prepared) return;
        setFeedbackResult({
          connection: prepared,
          message: "Sync failed. Check the environment connection and try again.",
        });
      }
    });
  };

  const handleSelectTheme = (item: PrismThemeDefinition) => {
    playSound("theme-switched");
    setTheme(item.id);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              data-slot="prism-theme-pill"
              className={cn(
                "group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-surface/80 px-2 py-0.5 text-xs font-medium text-foreground backdrop-blur shadow-sm transition-all hover:border-primary/50 hover:bg-surface active:scale-[0.98]",
                className,
              )}
            >
              <span
                className="size-2 rounded-full ring-2 ring-primary/20 transition-transform group-hover:scale-110"
                style={{ backgroundColor: activePrismTheme.colors.accent }}
              />
              <span className="min-w-0 truncate text-foreground/85">
                {activePrismTheme.label}
              </span>
            </PopoverTrigger>
          }
        />
        <TooltipPopup side="top">Prism theme · {activePrismTheme.label}</TooltipPopup>
      </Tooltip>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-80 rounded-2xl border border-border/80 bg-popover/95 p-3 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex flex-col gap-3">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-foreground flex items-center gap-1">
                ❖ Prism Themes
              </span>
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {PRISM_FLAGSHIP_THEMES.length} Themes
              </span>
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={handleSyncWithPrism}
              disabled={isSyncing || !prepared}
              className="h-6 gap-1 rounded-full px-2 text-[11px]"
            >
              <RefreshCw className={cn("size-3", isSyncing && "animate-spin")} />
              <span>{isSyncing ? "Syncing..." : "Sync host"}</span>
            </Button>
          </div>

          {/* Sync status toast message */}
          {syncFeedback && (
            <div
              role="status"
              className="rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-medium text-primary animate-in fade-in slide-in-from-top-1"
            >
              {syncFeedback}
            </div>
          )}

          {/* Theme Grid */}
          <div className="max-h-[300px] overflow-y-auto pr-1 space-y-1 scrollbar-thin">
            {PRISM_FLAGSHIP_THEMES.map((t) => {
              const isSelected = theme === t.id || (!theme && t.id === "prism-tide");
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelectTheme(t)}
                  type="button"
                  className={cn(
                    "w-full flex items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors",
                    isSelected
                      ? "bg-primary/15 text-foreground font-semibold border border-primary/30"
                      : "hover:bg-muted/70 text-foreground/80 border border-transparent",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* 3-color palette mini preview dot trio */}
                    <div className="flex -space-x-1 shrink-0 items-center">
                      <div
                        className="size-3.5 rounded-full border border-background shadow-xs"
                        style={{ backgroundColor: t.colors.canvas }}
                      />
                      <div
                        className="size-3.5 rounded-full border border-background shadow-xs"
                        style={{ backgroundColor: t.colors.surface }}
                      />
                      <div
                        className="size-3.5 rounded-full border border-background shadow-xs"
                        style={{ backgroundColor: t.colors.accent }}
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{t.label}</span>
                      <span className="text-[10px] text-muted-foreground truncate">
                        {t.appearance === "dark" ? "Dark mode" : "Light mode"}
                      </span>
                    </div>
                  </div>

                  {isSelected && <Check className="size-3.5 text-primary shrink-0 ml-2" />}
                </button>
              );
            })}
          </div>

          {/* Footer with macOS App integration status */}
          <div className="border-t border-border/50 pt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1 truncate">
              <span
                className={cn(
                  "size-1.5 rounded-full shrink-0",
                  prismStatus?.synced ? "bg-success" : "bg-muted-foreground",
                )}
              />
              {prismStatus?.synced
                ? "Host palette synced"
                : prismStatus?.error
                  ? "Host sync unavailable"
                  : "Host sync not checked"}
            </span>
            <span className="text-[10px] opacity-75">Active: {activePrismTheme.label}</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
