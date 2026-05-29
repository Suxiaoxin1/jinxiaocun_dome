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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
