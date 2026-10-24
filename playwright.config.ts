import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173/nexora/",
    headless: true,
    launchOptions: { executablePath: process.env.NEXORA_CHROMIUM_PATH },
  },
  webServer: {
    command: "node scripts/serve-dist.mjs",
    url: "http://127.0.0.1:4173/nexora/",
    reuseExistingServer: false,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
