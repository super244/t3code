/* agent-watermark: model=opus-5.5; effort=high; duration=6m; seat=claude-code; date=2026-10-22 */
import type { EnvironmentId } from "@t3tools/contracts";
import { BrainIcon } from "lucide-react";
import { useState } from "react";

import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { MemoryPanel } from "../memory/MemoryPanel";
import { RaceSelect } from "../race/RaceComposer";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Settings › Memory: everything agents remember on a connected computer. */
export function MemorySettings() {
  const { environments } = useEnvironments();
  const projects = useProjects();
  const connected = environments.filter(
    (environment) => environment.connection.phase === "connected",
  );
  const [picked, setPicked] = useState<string | null>(null);
  const environment =
    connected.find((item) => item.environmentId === picked) ?? connected[0] ?? null;
  const environmentProjects = environment
    ? projects
        .filter((project) => project.environmentId === environment.environmentId)
        .map((project) => ({ id: project.id, title: project.title }))
        .toSorted((left, right) => left.title.localeCompare(right.title))
    : [];

  return (
    <SettingsPageContainer>
      <SettingsSection
        id={searchableSetting("memory").id}
        title="Memory"
        icon={<BrainIcon className="size-4 text-muted-foreground" />}
        headerAction={
          connected.length > 1 && environment ? (
            <div className="w-48">
              <RaceSelect
                ariaLabel="Computer"
                value={environment.environmentId}
                options={connected.map((item) => ({
                  value: item.environmentId,
                  label: item.label,
                }))}
                onChange={setPicked}
              />
            </div>
          ) : null
        }
      >
        <div className="space-y-4 px-3 pb-4 sm:px-4">
          <p className="max-w-xl text-[13px] leading-[1.45] text-muted-foreground/80">
            Facts every new agent session starts with, whatever the provider: a project's memory in
            that project, and “Everywhere” in all of them. Agents add to it with their{" "}
            <code>remember</code> tool; correct or delete anything here.
          </p>
          {environment ? (
            <MemoryPanel
              environmentId={environment.environmentId as EnvironmentId}
              projects={environmentProjects}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Connect a computer to see what its agents remember.
            </p>
          )}
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
