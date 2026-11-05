import { defineConfig, devices } from "playwright/test";

/**
 * Runner config for the `playwright` package (not a separate `@playwright/test` dependency).
 * testDir is limited to e2e/ so `playwright test` does not load the node:test files under scripts/ and src/.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    headless: true,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
