import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Set by the Tauri CLI when developing against a remote device.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  resolve: {
    // Native path alias support (Vite 8); mirrors `paths` in tsconfig.app.json.
    tsconfigPaths: true,
  },
  // Prevent Vite from obscuring Rust errors.
  clearScreen: false,
  server: {
    // Must match `build.devUrl` in src-tauri/tauri.conf.json.
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // Tauri on Windows uses WebView2 (Chromium).
    target: "chrome105",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  plugins: [
    // Compiles messages/*.json into src/paraglide. All compiler options (outdir,
    // output structure, strategy) live in project.inlang/paraglide.config.js,
    // shared with `pnpm i18n:compile`.
    paraglideVitePlugin({ project: "./project.inlang" }),
    tailwindcss(),
    tanstackStart({
      router: {
        // Tests next to route files are not routes (docs/testing.md).
        routeFileIgnorePattern: String.raw`\.test\.tsx?$|^__tests__$`,
      },
      // SPA mode: static build, no server functions. The prerendered shell is
      // written as index.html so Tauri can serve dist/client directly; Tauri
      // serves it for every other path too (e.g. /overlay).
      spa: {
        enabled: true,
        prerender: {
          outputPath: "/index.html",
        },
      },
    }),
    // React's Vite plugin must come after the TanStack Start plugin.
    viteReact(),
  ],
});
