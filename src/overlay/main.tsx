import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { inTauri } from "../api";
import { Overlay } from "./Overlay";

// The desktop overlay window is transparent: only the panel itself is drawn.
if (inTauri()) {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);
