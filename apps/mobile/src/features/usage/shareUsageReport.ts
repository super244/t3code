/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=4m; seat=codex; date=2026-10-01 */
import {
  makeUsageReport,
  usageReportCsv,
  type UsageReportInput,
} from "@t3tools/shared/usageExport";

import { shareLocalAttachment } from "../../lib/attachmentDownload";
import { uuidv4 } from "../../lib/uuid";

/** The shared attachment cache owns receiver lifetime; this source is always temporary. */
export async function shareUsageReport(input: {
  readonly report: UsageReportInput;
  readonly format: "json" | "csv";
  readonly signal: AbortSignal;
  readonly sourceIdentifier?: string;
}): Promise<void> {
  if (input.signal.aborted) return;
  const { File, Paths } = await import("expo-file-system");
  if (input.signal.aborted) return;
  const report = makeUsageReport(input.report);
  const name = `t3-usage-${input.report.selectedProvider ?? "all"}-${input.report.exportedAt.slice(0, 10)}.${input.format}`;
  const file = new File(Paths.cache, `${uuidv4()}-${name}`);
  try {
    file.create();
    file.write(input.format === "json" ? JSON.stringify(report, null, 2) : usageReportCsv(report));
    await shareLocalAttachment({
      uri: file.uri,
      attachment: { name, mimeType: input.format === "json" ? "application/json" : "text/csv" },
      signal: input.signal,
      sourceIdentifier: input.sourceIdentifier,
    });
  } finally {
    try {
      if (file.exists) file.delete();
    } catch (error) {
      console.warn("Could not remove the temporary usage report.", error);
    }
  }
}
