import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Prevent Vite from obscuring Rust errors.
  clearScreen: false,
  build: {
    // The live overlay is its own page (its own window in the desktop app).
    rollupOptions: { input: { main: "index.html", overlay: "overlay.html" } },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    // Must match `build.devUrl` in src-tauri/tauri.conf.json.
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
