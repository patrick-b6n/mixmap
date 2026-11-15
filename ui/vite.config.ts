import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The live overlay is its own page (its own window in the desktop app).
    rollupOptions: { input: { main: "index.html", overlay: "overlay.html" } },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5173,
    // MIXMAP_API points a second UI at a second devserver (sync tests on one machine).
    proxy: { "/api": process.env.MIXMAP_API ?? "http://127.0.0.1:5174" },
  },
});
