import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";

import { createQueryClient } from "@/app/query-client";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // One client per router instance (the SPA shell is prerendered in its own
  // instance). Also passed as router context so loaders can prefetch.
  const queryClient = createQueryClient();

  return createRouter({
    context: { queryClient },
    routeTree,
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}
