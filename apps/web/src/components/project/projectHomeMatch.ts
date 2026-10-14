/* agent-watermark: model=haiku-5.5; effort=high; duration=42m; seat=claude-code; date=2026-10-13 */
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";

/**
 * Finds the sidebar project group a route key names. The logical key is what
 * the sidebar and settings use; the physical `environment:project` key is what
 * the launchpad rows carry. Either resolves to the same group.
 */
export function findProjectGroupForKey(
  groups: ReadonlyArray<SidebarProjectSnapshot>,
  projectKey: string,
): SidebarProjectSnapshot | null {
  return (
    groups.find((group) => group.projectKey === projectKey) ??
    groups.find((group) =>
      group.memberProjects.some(
        (member) =>
          member.physicalProjectKey === projectKey ||
          `${member.environmentId}:${member.id}` === projectKey,
      ),
    ) ??
    null
  );
}
