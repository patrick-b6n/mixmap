import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/ui/styles/globals.css";
import { inTauri } from "@/app/backend";
import { AppServicesProvider } from "@/app/app-services";
import { StartupErrorScreen } from "@/ui/layout/startup-screen";
import { Overlay } from "./Overlay";

// The desktop overlay window is transparent: only the panel itself is drawn.
if (inTauri()) {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppServicesProvider failed={(error) => <StartupErrorScreen error={error} />} loading={null}>
      <Overlay />
    </AppServicesProvider>
  </StrictMode>,
);
