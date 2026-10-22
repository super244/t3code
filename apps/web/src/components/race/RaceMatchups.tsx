/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=45m; seat=codex; date=2026-10-21 */
import type { RaceMatchup } from "@t3tools/shared/raceHistory";

function delta(value: number | null, unit: "time" | "cost"): string {
  if (value === null) return "Unreported";
  const magnitude =
    unit === "time" ? `${(Math.abs(value) / 1000).toFixed(1)}s` : `$${Math.abs(value).toFixed(4)}`;
  return `${value < 0 ? "−" : value > 0 ? "+" : ""}${magnitude}`;
}

export function RaceMatchups({
  rows,
  selectedKey,
  onSelect,
}: {
  readonly rows: ReadonlyArray<RaceMatchup>;
  readonly selectedKey: string | null;
  readonly onSelect: (row: RaceMatchup) => void;
}) {
  return (
    <section aria-label="Head-to-head races" className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">Head-to-head</h3>
      <p className="text-[11px] text-muted-foreground">
        Only races both models entered. Deltas are A minus B; negative means A used less. Repeated
        entries of the same harness and model in one race are excluded. View shared races scopes the
        leaderboard, history and exports.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No distinct model pairs in this selection.</p>
      ) : (
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Head-to-head results"
        >
          <table className="w-full min-w-[48rem] text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                {[
                  "A / B",
                  "Shared races",
                  "Kept A / B",
                  "No winner",
                  "Other kept",
                  "Winner unknown",
                  "Open",
                  "Median time Δ",
                  "Median cost Δ",
                ].map((label) => (
                  <th key={label} scope="col" className="px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-border/60">
                  <th scope="row" className="max-w-64 px-3 py-2 text-left font-normal">
                    <div>A · {row.left.label}</div>
                    <div className="text-muted-foreground">B · {row.right.label}</div>
                    <button
                      type="button"
                      className="mt-1 text-[11px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
                      aria-label={`View shared races: ${row.left.label} versus ${row.right.label}`}
                      aria-pressed={selectedKey === row.key}
                      onClick={() => onSelect(row)}
                    >
                      View shared races
                    </button>
                  </th>
                  <td className="px-3 py-2 tabular-nums">{row.races}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.leftWins} / {row.rightWins}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{row.noWinner}</td>
                  <td className="px-3 py-2 tabular-nums">{row.otherWinner}</td>
                  <td className="px-3 py-2 tabular-nums">{row.unknownWinner}</td>
                  <td className="px-3 py-2 tabular-nums">{row.open}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {delta(row.medianTimeDeltaMs, "time")}
                    <div className="text-[10px] text-muted-foreground">
                      {row.timePairs} paired reports
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {delta(row.medianCostDeltaUsd, "cost")}
                    <div className="text-[10px] text-muted-foreground">
                      {row.costPairs} paired reports
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
