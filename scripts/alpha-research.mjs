import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { metrics } from "./quality-metrics.mjs";
import { svgPoints } from "./stage12-svg-metrics.mjs";
const root = "benchmark-results/coverage";
await mkdir(root, { recursive: true });
const server = spawn("node", ["scripts/serve-dist.mjs"], {
  env: { ...process.env, NEXORA_RESEARCH: "1", NEXORA_PORT: "4197" },
  stdio: "ignore",
});
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH || "/usr/bin/chromium",
});
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch("http://127.0.0.1:4197/nexora/")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4197/nexora/");
  const rows = [];
  for (const size of [128, 512, 1024]) {
    const file = `tests/fixtures/quality/cat-${size}-partial.png`;
    const rgba = await sharp(file).ensureAlpha().raw().toBuffer();
    for (const mode of [0, 1, 2]) {
      const result = await page.evaluate(
        async ({ base64, size, mode }) => {
          const m = await import("/research/nexora_wasm.js");
          await m.default();
          const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const start = performance.now();
          const svg = m.alpha_experiment(
            data,
            size,
            size,
            "illustration",
            mode,
          );
          return { svg, ms: performance.now() - start };
        },
        { base64: rgba.toString("base64"), size, mode },
      );
      const raster = await sharp(Buffer.from(result.svg))
        .ensureAlpha()
        .raw()
        .toBuffer();
      rows.push({
        size,
        mode,
        ms: result.ms,
        bytes: Buffer.byteLength(result.svg),
        ...svgPoints(result.svg),
        ...metrics(rgba, raster, size, size, false),
      });
      await writeFile(`${root}/alpha-${size}-${mode}.svg`, result.svg);
      console.log(rows.at(-1));
    }
  }
  await writeFile(`${root}/alpha.json`, JSON.stringify(rows, null, 2));
} finally {
  await browser.close();
  server.kill();
}
