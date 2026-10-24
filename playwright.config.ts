import { defineConfig } from "@playwright/test";
const port = Number(process.env.NEXORA_TEST_PORT || 4173);
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}/nexora/`,
    headless: true,
    launchOptions: { executablePath: process.env.NEXORA_CHROMIUM_PATH },
  },
  webServer: {
    command: `NEXORA_PORT=${port} node scripts/serve-dist.mjs`,
    url: `http://127.0.0.1:${port}/nexora/`,
    reuseExistingServer: false,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
