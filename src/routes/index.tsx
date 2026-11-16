import { createFileRoute } from "@tanstack/react-router";

import { MainWindow } from "@/ui/MainWindow";

/** The main window: library, graph and settings. */
export const Route = createFileRoute("/")({
  component: MainWindow,
});
