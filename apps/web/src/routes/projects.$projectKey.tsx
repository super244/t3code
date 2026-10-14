/* agent-watermark: model=haiku-5.5; effort=high; duration=42m; seat=claude-code; date=2026-10-13 */
import { createFileRoute, redirect } from "@tanstack/react-router";

import { ProjectHomePage } from "../components/project/ProjectHomePage";

function ProjectHomeRoute() {
  const { projectKey } = Route.useParams();
  return <ProjectHomePage projectKey={projectKey} />;
}

export const Route = createFileRoute("/projects/$projectKey")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ProjectHomeRoute,
});
