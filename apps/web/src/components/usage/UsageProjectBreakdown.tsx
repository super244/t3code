import type { UsageProviderKind } from "@t3tools/contracts";
import { formatPercent, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import type { ProjectUsageSummary } from "@t3tools/shared/usageProjects";

import { useState } from "react";

import { cn } from "../../lib/utils";
import { PROVIDER_PRESENTATION } from "./usageProviders";

/**
 * Usage by the project each session ran in. Only Claude Code records the
 * project in its transcript layout; other providers' usage is grouped as
 * "Not recorded" rather than guessed.
 */
export function UsageProjectBreakdown({
  summary,
  hasActivity,
}: {
  readonly summary: ProjectUsageSummary;
  readonly hasActivity: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-2/5" />
          <col className="w-1/5" />
          <col className="w-1/5" />
          <col className="w-1/5" />
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 font-normal">Project</th>
            <th className="py-2 text-right font-normal">Cost</th>
            <th className="py-2 text-right font-normal">Share</th>
            <th className="py-2 text-right font-normal">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {summary.projects.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-6 text-center text-muted-foreground">
                {hasActivity
                  ? "This environment does not report usage by project yet."
                  : "No activity in this window."}
              </td>
            </tr>
          ) : (
            summary.projects.map((project) => {
              const open = expanded === project.key;
              const canExpand = project.models.length > 0;
              return [
                <tr
                  key={project.key}
                  className={cn(
                    "border-b border-border/50 transition-colors hover:bg-muted/50",
                    canExpand && "cursor-pointer",
                  )}
                  onClick={canExpand ? () => setExpanded(open ? null : project.key) : undefined}
                  aria-expanded={canExpand ? open : undefined}
                >
                  <td className="py-2 text-foreground">
                    <span
                      className="flex min-w-0 items-center gap-2"
                      title={project.projectPath ?? undefined}
                    >
                      <span className="flex shrink-0 gap-0.5">
                        {project.providers.map((provider: UsageProviderKind) => {
                          const Mark = PROVIDER_PRESENTATION[provider].mark;
                          return <Mark key={provider} className="size-3.5 shrink-0" aria-hidden />;
                        })}
                      </span>
                      <span
                        className={cn(
                          "truncate",
                          project.projectPath === null && "text-muted-foreground",
                        )}
                      >
                        {project.name}
                      </span>
                      <span className="ml-1 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {project.sessions} {project.sessions === 1 ? "session" : "sessions"}
                      </span>
                    </span>
                  </td>
                  <td className="py-2 text-right text-foreground tabular-nums">
                    {formatUsd(project.costUsd)}
                  </td>
                  <td className="py-2 text-right text-muted-foreground tabular-nums">
                    {formatPercent(project.costShare)}
                  </td>
                  <td className="py-2 text-right text-muted-foreground tabular-nums">
                    {formatTokens(project.totalTokens)}
                  </td>
                </tr>,
                open
                  ? project.models.map((model) => (
                      <tr
                        key={`${project.key}:${model.model}`}
                        className="border-b border-border/30 bg-muted/20 text-xs"
                      >
                        <td className="py-1.5 pl-8 text-muted-foreground">{model.model}</td>
                        <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                          {formatUsd(model.costUsd)}
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                          {formatPercent(project.costUsd > 0 ? model.costUsd / project.costUsd : 0)}
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                          {formatTokens(model.totalTokens)}
                        </td>
                      </tr>
                    ))
                  : null,
              ];
            })
          )}
        </tbody>
      </table>
      {summary.partial ? (
        <p className="text-xs text-muted-foreground">
          An environment predates usage by project; update it to include its usage here.
        </p>
      ) : null}
    </div>
  );
}
