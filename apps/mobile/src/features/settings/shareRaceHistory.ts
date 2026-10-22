/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=16m; seat=codex; date=2026-10-21 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=40m; seat=codex; date=2026-10-20 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=24m; seat=codex; date=2026-10-19 */
import type { EnvironmentId, RaceHistoryRecord } from "@t3tools/contracts";
import {
  buildRaceLeaderboard,
  buildRaceMatchups,
  raceHistoryCsv,
  raceEvidenceMarkdown,
} from "@t3tools/shared/raceHistory";
import { shareLocalAttachment } from "../../lib/attachmentDownload";
import { uuidv4 } from "../../lib/uuid";

export async function shareRaceHistory(input: {
  readonly records: ReadonlyArray<RaceHistoryRecord>;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly filters: Readonly<Record<string, string>>;
  readonly format: "json" | "csv" | "md";
  readonly signal: AbortSignal;
}): Promise<void> {
  if (input.signal.aborted) return;
  const capturedAt = new Date().toISOString();
  const records = input.records.map((record) => ({
    ...record,
    environmentId: input.environmentId,
    environmentLabel: input.environmentLabel,
  }));
  const contents =
    input.format === "md"
      ? raceEvidenceMarkdown(records, capturedAt)
      : input.format === "csv"
        ? raceHistoryCsv(records)
        : JSON.stringify(
            {
              version: 1,
              capturedAt,
              environmentId: input.environmentId,
              environmentLabel: input.environmentLabel,
              scope:
                "Retained history on this computer, up to 500 races. Missing costs are unknown. Includes every filtered match, not only the displayed page.",
              filters: input.filters,
              records,
              leaderboard: buildRaceLeaderboard(records),
              matchups: buildRaceMatchups(records),
            },
            null,
            2,
          );
  const { File, Paths } = await import("expo-file-system");
  if (input.signal.aborted) return;
  const name = `t3-races-${capturedAt.slice(0, 10)}.${input.format}`;
  const file = new File(Paths.cache, `${uuidv4()}-${name}`);
  try {
    file.create();
    file.write(contents);
    await shareLocalAttachment({
      uri: file.uri,
      attachment: {
        name,
        mimeType:
          input.format === "md"
            ? "text/markdown"
            : input.format === "csv"
              ? "text/csv"
              : "application/json",
      },
      signal: input.signal,
    });
  } finally {
    try {
      if (file.exists) file.delete();
    } catch (error) {
      console.warn("Could not remove the temporary race evidence file.", error);
    }
  }
}
