/* agent-watermark: model=opus-5.5; effort=high; duration=8m; seat=claude-code; date=2026-10-19 */
import type { EnvironmentId } from "@t3tools/contracts";
import { parseRaceBranchName, parseRaceJudgeMarker } from "@t3tools/shared/race";
import { Link } from "@tanstack/react-router";
import { ColumnsIcon, GavelIcon } from "lucide-react";
import { memo } from "react";

const pillClass =
  "pointer-events-auto inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-xs backdrop-blur hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/**
 * At the top of a race entrant or a race judge: where the race is and how to
 * get back to its arena, so a thread opened from the sidebar is never cut off
 * from the race it belongs to.
 */
export const RaceLinks = memo(function RaceLinks({
  thread,
}: {
  thread: {
    readonly environmentId: EnvironmentId;
    readonly branch: string | null;
    readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
  };
}) {
  const entrant = parseRaceBranchName(thread.branch);
  const judgedRaceId = entrant
    ? null
    : parseRaceJudgeMarker(thread.messages.find((message) => message.role === "user")?.text);
  const raceId = entrant?.raceId ?? judgedRaceId;
  if (!raceId) return null;
  return (
    <div className="mx-auto flex w-fit max-w-[min(48rem,calc(100%-2rem))] items-center justify-center pt-2">
      <Link className={pillClass} to="/race" search={{ race: raceId, env: thread.environmentId }}>
        {entrant ? (
          <ColumnsIcon className="size-3.5 shrink-0" />
        ) : (
          <GavelIcon className="size-3.5 shrink-0" />
        )}
        <span className="truncate">
          {entrant
            ? `Entrant ${entrant.slot} of ${entrant.count} in a race · Compare`
            : "Judging a race · Open the arena"}
        </span>
      </Link>
    </div>
  );
});
