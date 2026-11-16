import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import { StartupErrorScreen, StartupLoadingScreen } from "@/ui/layout/startup-screen";

import { backend, inTauri } from "./backend";
import { openAppDatabase } from "./database";
import { type AppServices, createAppServices } from "./services";
import { m } from "@/paraglide/messages.js";

const AppServicesContext = createContext<AppServices | null>(null);

let started: Promise<AppServices> | undefined;

/** Opens the database and creates the services, once per window. */
export function startApp(): Promise<AppServices> {
  started ??= (async () => {
    if (!inTauri()) throw new Error(m.startup_desktop_only());
    const { sql } = await openAppDatabase();
    return createAppServices(sql, backend);
  })().catch((error: unknown) => {
    started = undefined;
    throw error;
  });
  return started;
}

type State =
  | { status: "loading" }
  | { error: string; status: "failed" }
  | { services: AppServices; status: "ready" };

/**
 * Starts the app (database, migrations, services) and renders `children` with the
 * services once ready – until then a loading screen, on failure an error screen.
 * The start runs in an effect, i.e. only in the WebView: the prerendered SPA shell
 * (Node) contains the loading screen.
 */
export function AppServicesProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let active = true;
    startApp().then(
      (services) => active && setState({ services, status: "ready" }),
      (error: unknown) => {
        console.error("App start failed", error);
        if (active) setState({ error: String(error), status: "failed" });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  if (state.status === "loading") return <StartupLoadingScreen />;
  if (state.status === "failed") return <StartupErrorScreen error={state.error} />;
  return (
    <AppServicesContext.Provider value={state.services}>{children}</AppServicesContext.Provider>
  );
}

/** The app's services; only below {@link AppServicesProvider}. */
export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (!services) throw new Error("useAppServices() must be used below <AppServicesProvider>");
  return services;
}
