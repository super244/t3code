import { Button } from "../ui/button";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  deriveCacheEfficiency,
  deriveDetailedTokenBreakdown,
  formatContextWindowCompactionMessage,
} from "./ContextWindowMeter.logic";
import { Minimize2Icon, ZapIcon } from "lucide-react";
import { composerFloatingLayerProps } from "./composerEventScope";

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  modelDisplayName?: string | null;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean | undefined;
  compactDisabledReason?: string | null | undefined;
}) {
  const { usage, modelDisplayName, onCompact, compactDisabled, compactDisabledReason } = props;
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedPercentage / 100);
  const totalProcessedTokens = usage.totalProcessedTokens ?? null;
  const showTotalProcessed = totalProcessedTokens !== null && totalProcessedTokens > 0;
  const isOverloaded = normalizedPercentage > 90;
  const usageColor = isOverloaded
    ? "var(--color-error)"
    : "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";

  const cacheEfficiency = deriveCacheEfficiency({
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
  });

  const detailedBreakdown = deriveDetailedTokenBreakdown(usage);

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={onCompact ? 150 : 0}
        render={
          <Button
            size="icon-sm"
            variant="ghost-muted"
            className="size-7 rounded-full hover:text-muted-foreground data-pressed:text-muted-foreground"
            aria-label={
              usage.maxTokens !== null && usedPercentage
                ? `Context window ${usedPercentage} used`
                : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
            }
          >
            <span className="relative flex size-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 size-full transform-gpu mx-0!"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)"
                  strokeWidth="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke={usageColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
            </span>
          </Button>
        }
      />
      <PopoverPopup
        {...composerFloatingLayerProps}
        tooltipStyle
        side="top"
        align="end"
        viewportClassName="p-0"
        className="w-72 max-w-none text-left whitespace-normal"
      >
        <div className="flex flex-col gap-2.5 p-[var(--floating-content-inset)]">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-muted-foreground text-xs">Context Window</div>
            {usage.maxTokens !== null && usedPercentage ? (
              <div className="text-secondary-label text-[11px] tabular-nums">
                <span>{usedPercentage}</span>
                <span className="mx-1">·</span>
                <span>
                  {formatContextWindowTokens(usage.usedTokens)}/
                  {formatContextWindowTokens(usage.maxTokens ?? null)}
                </span>
              </div>
            ) : (
              <div className="text-secondary-label text-[11px] tabular-nums">
                {formatContextWindowTokens(usage.usedTokens)}
              </div>
            )}
          </div>
          {usage.maxTokens !== null ? (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(normalizedPercentage)}
              aria-label="Context window usage"
            >
              <div
                className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${normalizedPercentage}%`, backgroundColor: usageColor }}
              />
            </div>
          ) : null}

          {cacheEfficiency ? (
            <div className="flex items-center justify-between rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-600 text-[11px] font-medium dark:bg-emerald-500/15 dark:text-emerald-400">
              <span className="flex items-center gap-1.5">
                <ZapIcon className="size-3 shrink-0" />
                <span>Prompt Cache Hit</span>
              </span>
              <span className="font-semibold tabular-nums">{cacheEfficiency.label}</span>
            </div>
          ) : null}

          {(detailedBreakdown.inputTokens !== null || detailedBreakdown.outputTokens !== null) && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded border border-border/50 bg-muted/20 px-2.5 py-1.5 text-[11px]">
              {detailedBreakdown.uncachedInputTokens !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-secondary-label">Prompt:</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {formatContextWindowTokens(detailedBreakdown.uncachedInputTokens)}
                  </span>
                </div>
              )}
              {detailedBreakdown.cachedInputTokens !== null &&
                detailedBreakdown.cachedInputTokens > 0 && (
                  <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                    <span>Cached:</span>
                    <span className="font-mono tabular-nums">
                      {formatContextWindowTokens(detailedBreakdown.cachedInputTokens)}
                    </span>
                  </div>
                )}
              {detailedBreakdown.outputTokens !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-secondary-label">Output:</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {formatContextWindowTokens(detailedBreakdown.outputTokens)}
                  </span>
                </div>
              )}
              {detailedBreakdown.reasoningTokens !== null &&
                detailedBreakdown.reasoningTokens > 0 && (
                  <div className="flex items-center justify-between text-indigo-500 dark:text-indigo-400">
                    <span>Reasoning:</span>
                    <span className="font-mono tabular-nums">
                      {formatContextWindowTokens(detailedBreakdown.reasoningTokens)}
                    </span>
                  </div>
                )}
            </div>
          )}

          {showTotalProcessed ? (
            <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
              <span className="text-secondary-label">Total processed</span>
              <span className="font-medium tabular-nums text-secondary-label">
                {formatContextWindowTokens(totalProcessedTokens)}
              </span>
            </div>
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="mt-1 text-pretty text-secondary-label text-[11px] font-medium">
              {formatContextWindowCompactionMessage(modelDisplayName, usage.autoCompactThreshold)}
            </div>
          ) : null}
          {onCompact ? (
            <>
              <Button
                size="xs"
                variant="outline"
                className="mt-1 w-full justify-center"
                disabled={compactDisabled}
                onClick={onCompact}
              >
                <Minimize2Icon aria-hidden="true" />
                Compact context
              </Button>
              {compactDisabled && compactDisabledReason ? (
                <div className="text-pretty text-secondary-label text-[11px]">
                  {compactDisabledReason}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** Holds the meter's footprint while a thread's activities are still loading. */
export function ContextWindowMeterPlaceholder() {
  return <span aria-hidden="true" className="size-7 shrink-0" />;
}
