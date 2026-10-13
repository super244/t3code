/* agent-watermark: model=haiku-5.5; effort=high; duration=20m; seat=claude-code; date=2026-10-12 */
import type { TurnId } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { CircleCheckIcon, CircleXIcon, ListChecksIcon, MinusIcon } from "lucide-react";
import { memo, useState } from "react";

import { formatTurnRecapFileCount, turnRecapStateLabel, type TurnRecap } from "~/lib/turnRecap";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { DiffStatLabel } from "./DiffStatLabel";

// Commands past this count are summarized in a line, so a long turn cannot
// stretch the popover past the viewport.
const MAX_LISTED_COMMANDS = 12;

function SectionTitle(props: { readonly children: string }) {
  return (
    <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {props.children}
    </h3>
  );
}

/**
 * Header control for the latest settled turn: what it changed, which commands
 * ran and how they exited, how long it took, and the first line of its final
 * message. Every value comes from the recap; an unknown value says so.
 */
export const TurnRecapControl = memo(function TurnRecapControl(props: {
  readonly recap: TurnRecap;
  readonly compact: boolean;
  readonly onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  const { recap, compact, onOpenTurnDiff } = props;
  const [open, setOpen] = useState(false);
  const files = recap.files;
  const durationLabel = recap.durationMs === null ? null : formatDuration(recap.durationMs);
  const hasFailed = recap.failedCommandCount > 0;
  const shownCommands = recap.commands.slice(0, MAX_LISTED_COMMANDS);
  const hiddenCommandCount = recap.commands.length - shownCommands.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            aria-label="Turn recap"
            className={cn(
              "shrink-0 text-muted-foreground hover:text-foreground",
              hasFailed && "text-red-600 dark:text-red-400",
            )}
          />
        }
      >
        <ListChecksIcon aria-hidden className="size-3.5" />
        {compact ? null : <span className="hidden @3xl/header-actions:inline">Recap</span>}
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">Last turn</p>
            <p
              className={cn(
                "text-xs tabular-nums",
                recap.state === "error"
                  ? "text-red-600 dark:text-red-400"
                  : "text-muted-foreground",
              )}
            >
              {turnRecapStateLabel(recap.state)}
              {durationLabel === null ? "" : ` · ${durationLabel}`}
            </p>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {files === null ? (
              <span>File changes were not recorded for this turn.</span>
            ) : (
              <>
                <span>{formatTurnRecapFileCount(files.length)}</span>
                {files.length > 0 ? (
                  <DiffStatLabel
                    additions={recap.additions ?? 0}
                    deletions={recap.deletions ?? 0}
                    layout="inline"
                    className="text-xs"
                  />
                ) : null}
              </>
            )}
          </p>
        </div>

        <section className="border-b px-3 py-2">
          <SectionTitle>Changed files</SectionTitle>
          {files !== null && files.length > 0 ? (
            <ul className="max-h-56 overflow-y-auto">
              {files.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    aria-label={`Open diff for ${file.path}`}
                    onClick={() => {
                      setOpen(false);
                      onOpenTurnDiff(recap.turnId, file.path);
                    }}
                    className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                  >
                    <span className="flex min-w-0 flex-1 items-baseline font-mono">
                      <span className="min-w-0 truncate text-muted-foreground">
                        {file.path.slice(0, file.path.lastIndexOf("/") + 1)}
                      </span>
                      <span className="shrink-0 text-foreground">
                        {file.path.slice(file.path.lastIndexOf("/") + 1)}
                      </span>
                    </span>
                    <DiffStatLabel
                      additions={file.additions}
                      deletions={file.deletions}
                      layout="inline"
                      className="shrink-0 text-xs"
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {files === null
                ? "No changed-files record exists for this turn."
                : "This turn did not change any files."}
            </p>
          )}
        </section>

        <section className="border-b px-3 py-2">
          <SectionTitle>
            {recap.commands.length > 0 ? `Commands · ${recap.commands.length}` : "Commands"}
          </SectionTitle>
          {recap.commands.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No commands were recorded for this turn.
            </p>
          ) : (
            <>
              <ul className="max-h-48 overflow-y-auto">
                {shownCommands.map((command, index) => (
                  <li
                    // Commands carry no id in the recap; their order is the turn's order.
                    key={`${index}-${command.label}`}
                    className="flex items-center gap-2 px-1.5 py-1 text-xs"
                  >
                    {command.failed ? (
                      <span className="shrink-0 text-red-600 dark:text-red-400">
                        <CircleXIcon aria-hidden className="size-3.5" />
                        <span className="sr-only">Failed</span>
                      </span>
                    ) : command.status === "completed" ? (
                      <span className="shrink-0 text-emerald-600 dark:text-emerald-400">
                        <CircleCheckIcon aria-hidden className="size-3.5" />
                        <span className="sr-only">Completed</span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-muted-foreground">
                        <MinusIcon aria-hidden className="size-3.5" />
                        <span className="sr-only">Status not recorded</span>
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                      {command.label}
                    </span>
                    {command.exitCode !== null || command.status !== null ? (
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {command.exitCode !== null ? `exit ${command.exitCode}` : command.status}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {hiddenCommandCount > 0 ? (
                <p className="px-1.5 pt-1 text-xs text-muted-foreground">
                  {hiddenCommandCount} more not shown
                </p>
              ) : null}
            </>
          )}
        </section>

        <section className="px-3 py-2">
          <SectionTitle>Final message</SectionTitle>
          {recap.finalMessageFirstLine === null ? (
            <p className="text-xs text-muted-foreground">
              No final message was recorded for this turn.
            </p>
          ) : (
            <p className="line-clamp-2 text-xs text-foreground">{recap.finalMessageFirstLine}</p>
          )}
        </section>
      </PopoverPopup>
    </Popover>
  );
});
