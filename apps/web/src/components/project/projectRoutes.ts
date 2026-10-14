/* agent-watermark: model=haiku-5.5; effort=high; duration=42m; seat=claude-code; date=2026-10-13 */

/**
 * The project home. `projectKey` is a logical project key from the sidebar
 * grouping, or a physical `environment:project` key, which the route resolves.
 */
export function projectHomeTarget(projectKey: string) {
  return { to: "/projects/$projectKey", params: { projectKey } } as const;
}

/**
 * Project settings lives in Settings › Projects. Every "project settings" entry
 * (gear, palette, context menu) points here, not at the project home.
 */
export function projectSettingsTarget(projectKey: string) {
  return {
    to: "/settings/projects",
    search: { project: projectKey, machine: undefined },
  } as const;
}
