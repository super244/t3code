import { createFileRoute } from "@tanstack/react-router";

import { RoutinesPage } from "../components/routines/RoutinesPage";

export const Route = createFileRoute("/routines")({
  component: RoutinesPage,
});
