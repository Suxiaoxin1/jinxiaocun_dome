import { defineConfig, devices } from "@playwright/test";

const noProxyEntries = new Set(
  (process.env.NO_PROXY ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
);

noProxyEntries.add("127.0.0.1");
noProxyEntries.add("localhost");
process.env.NO_PROXY = Array.from(noProxyEntries).join(",");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? ":memory:",
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? ":memory:",
    },
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
