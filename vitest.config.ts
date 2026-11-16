import { defineConfig } from "vitest/config";

// Run tests in a non-UTC time zone (UTC-11, no DST) so code that accidentally
// formats in local time fails instead of passing on UTC CI runners. Set before
// workers start, so they inherit it.
process.env.TZ = "Pacific/Pago_Pago";

// Kept separate from vite.config.ts so tests don't load the app's Vite plugins.
// Conventions: docs/testing.md.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Business and persistence tests run in Node; there are no DOM tests yet.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
