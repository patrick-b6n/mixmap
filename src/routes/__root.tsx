import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { AppServicesProvider } from "@/app/app-services";
import appCss from "@/ui/styles/globals.css?url";
import { m } from "@/paraglide/messages.js";

export type RouterContext = {
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "dark" },
      { title: m.app_title() },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
});

function RootComponent() {
  return (
    <RootDocument>
      {/* Opens the database before the window renders; error screen on failure. */}
      <AppServicesProvider>
        <Outlet />
      </AppServicesProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div id="root">{children}</div>
        <Toaster
          position="bottom-center"
          theme="dark"
          toastOptions={{ className: "!text-[13px]" }}
        />
        <Scripts />
      </body>
    </html>
  );
}
