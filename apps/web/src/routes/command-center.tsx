import { createFileRoute } from "@tanstack/react-router";

import { CommandCenterPage } from "../components/command-center/CommandCenterPage";

export const Route = createFileRoute("/command-center")({
  component: CommandCenterPage,
});
