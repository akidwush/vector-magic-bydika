import { defineConfig } from "vitest/config";
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  test: { environment: "jsdom", include: ["tests/unit/**/*.test.ts"] },
});
