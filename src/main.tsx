import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppServicesProvider } from "@/app/app-services";
import App from "@/ui/App";
import { StartupErrorScreen, StartupLoadingScreen } from "@/ui/layout/startup-screen";
import "@/ui/styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppServicesProvider
      failed={(error) => <StartupErrorScreen error={error} />}
      loading={<StartupLoadingScreen />}
    >
      <App />
    </AppServicesProvider>
  </StrictMode>,
);
