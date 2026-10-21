import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Runs against the isolated stack from docker-compose.e2e.yml (`make e2e`).
// `readonly` alone may target any deployment: E2E_BASE_URL=https://… bunx playwright test --project=readonly
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8090";
const ADMIN_STATE = path.join(import.meta.dirname, "e2e", ".auth", "admin-state.json");
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  // `next dev` compiles each route on first hit; a cold page can take minutes.
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 2,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "./e2e/.report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 240_000,
    locale: "en-US",
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    { name: "api", testMatch: /api\/.*\.spec\.ts/, dependencies: ["setup"] },
    {
      name: "web",
      testMatch: /web\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...desktop, storageState: ADMIN_STATE },
    },
    {
      name: "mobile",
      testMatch: /web\/.*\.spec\.ts/,
      grep: /@mobile/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], storageState: ADMIN_STATE },
    },
    // Anonymous GETs only; safe against a stack with real data.
    { name: "readonly", testMatch: /readonly\/.*\.spec\.ts/, use: desktop },
  ],
});
