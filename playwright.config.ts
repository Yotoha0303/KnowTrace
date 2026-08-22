import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // A full knowledge workflow performs several server actions and may trigger
  // first-use route compilation in `next dev`. Keep the per-assertion timeout
  // strict while allowing the complete scenario enough time to finish.
  timeout: 90_000,
  fullyParallel: false,
  // The product currently has one shared knowledge domain even when optional
  // authentication is enabled. Serial browser tests prevent global
  // revalidation and cleanup from one scenario racing another scenario.
  workers: 1,
  retries: 0,
  reporter: "html",
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
